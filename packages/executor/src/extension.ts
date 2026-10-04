// pi-coding-agent extension: the Executor tools with terminal rendering,
// interactive approvals, and an `/executor` status command.
//
// Configuration comes from the environment (see `ExecutorClient.optionsFromEnv`)
// and is resolved on first use, so a missing setting surfaces as a tool error
// and in `/executor` instead of failing Pi at startup.

import {
  defineTool,
  highlightCode,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Effect, Exit } from "effect";

import * as ExecutorClient from "./client.ts";
import type { ApprovalDecider, ApprovalRequest } from "./policy.ts";
import type { ResumeAnswer } from "./schemas.ts";
import {
  EXECUTE_TOOL,
  ExecuteParams,
  SEARCH_TOOL,
  SearchOutput,
  SearchParams,
  runExecute,
  runSearch,
  type ExecuteDetails,
  type SearchDetails,
} from "./tools.ts";

const COLLAPSED_LINES = 12;

const lines = (text: string, expanded: boolean): string[] => {
  const all = text.split("\n");
  if (expanded || all.length <= COLLAPSED_LINES) return all;
  return [...all.slice(0, COLLAPSED_LINES), `… ${all.length - COLLAPSED_LINES} more lines`];
};

const textOf = (result: {
  readonly content: ReadonlyArray<{ type: string; text?: string }>;
}): string =>
  result.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

const offeredPersistence = (request: ApprovalRequest): string[] => {
  const persist = request.meta?.["persist"];
  return Array.isArray(persist)
    ? persist.filter((scope): scope is string => typeof scope === "string")
    : [];
};

const hasFormFields = (schema: Record<string, unknown> | undefined): boolean => {
  const properties = schema?.["properties"];
  return (
    typeof properties === "object" && properties !== null && Object.keys(properties).length > 0
  );
};

const parseFormContent = (input: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(input);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Executor form answers must be a JSON object.");
  }
  return Object.fromEntries(Object.entries(parsed));
};

const ONCE = "This call only";

/** Ask the person at the terminal; without a UI, decline. */
export const interactivePolicy =
  (ctx: ExtensionContext): ApprovalDecider =>
  async (request): Promise<ResumeAnswer> => {
    if (!ctx.hasUI) return { action: "decline" };
    const title = `Executor: ${request.address}`;

    let content: Record<string, unknown> | undefined;
    if (request.kind === "url") {
      ctx.ui.notify(`Open to continue: ${request.url ?? "(no URL given)"}`, "warning");
      const choice = await ctx.ui.select(`${title} — ${request.message}`, [
        "Done, continue",
        "Decline",
        "Cancel",
      ]);
      if (choice !== "Done, continue")
        return { action: choice === "Decline" ? "decline" : "cancel" };
    } else if (hasFormFields(request.requestedSchema)) {
      const input = await ctx.ui.input(
        `${title} — ${request.message}`,
        `JSON object matching:\n${JSON.stringify(request.requestedSchema, null, 2)}`,
      );
      if (input === undefined) return { action: "cancel" };
      content = parseFormContent(input);
    } else {
      const args = JSON.stringify(request.args, null, 2) ?? "";
      if (!(await ctx.ui.confirm(title, `${request.message}\n\n${args}`)))
        return { action: "decline" };
    }

    const scopes = offeredPersistence(request);
    let persist: string | undefined;
    if (scopes.length > 0) {
      const choice = await ctx.ui.select("Remember this approval?", [ONCE, ...scopes]);
      // Dismissing this prompt is not consent; only an explicit choice accepts.
      if (choice === undefined) return { action: "cancel" };
      if (choice !== ONCE) persist = choice;
    }
    return {
      action: "accept",
      ...(content === undefined ? {} : { content }),
      ...(persist === undefined ? {} : { persist }),
    };
  };

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const renderSearchResult = (
  details: SearchDetails,
  text: string,
  expanded: boolean,
  theme: Theme,
): Text => {
  if (details.items.length === 0) return new Text(theme.fg("muted", text), 0, 0);
  const body = details.items.flatMap((item) => {
    const head = `${theme.fg("toolOutput", item.path)} ${theme.fg("dim", item.score.toFixed(2))}`;
    if (!expanded) return [head];
    return [
      head,
      ...(item.inputTypeScript ? [theme.fg("dim", `  input: ${item.inputTypeScript}`)] : []),
      ...(item.outputTypeScript ? [theme.fg("dim", `  output: ${item.outputTypeScript}`)] : []),
      ...(item.detailsError
        ? [theme.fg("warning", `  types unavailable: ${item.detailsError}`)]
        : []),
    ];
  });
  return new Text(body.join("\n"), 0, 0);
};

const renderExecuteResult = (
  details: ExecuteDetails,
  text: string,
  isError: boolean,
  expanded: boolean,
  theme: Theme,
): Text => {
  const approvals = details.approvals.map((approval) =>
    theme.fg(
      approval.action === "accept" ? "success" : "warning",
      `${approval.action}: ${approval.address}`,
    ),
  );
  const calls = (details.toolCalls ?? []).map((call) =>
    theme.fg(
      call.isError ? "error" : "dim",
      `→ ${call.path}${call.durationMs === undefined ? "" : ` ${call.durationMs}ms`}`,
    ),
  );
  const body = lines(text, expanded).map((line) =>
    theme.fg(isError ? "error" : "toolOutput", line),
  );
  return new Text([...approvals, ...calls, ...body].join("\n"), 0, 0);
};

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function executorExtension(pi: ExtensionAPI): void {
  let client: Promise<ExecutorClient.Interface> | undefined;
  const resolveClient = (): Promise<ExecutorClient.Interface> => {
    client ??= Effect.runPromise(
      Effect.map(ExecutorClient.optionsFromEnv, ExecutorClient.create),
    ).catch((error: unknown) => {
      client = undefined;
      throw error;
    });
    return client;
  };
  const configFailure = (error: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: `Executor is not configured: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  });

  pi.registerTool(
    defineTool<typeof SearchParams, SearchDetails>({
      ...SEARCH_TOOL,
      parameters: SearchParams,
      outputSchema: SearchOutput,
      executionMode: "parallel",
      annotations: { readOnlyHint: true, openWorldHint: false },
      promptSnippet: "Find Executor tool paths and TypeScript shapes by intent.",
      promptGuidelines: [
        "Use executor_search before executor_execute when the Executor tool path or input shape is unknown.",
        "Use short intent phrases such as 'list repository issues' or 'create calendar event'.",
      ],
      async execute(_toolCallId, params, signal) {
        const resolved = await resolveClient().then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        if (!resolved.ok) return { ...configFailure(resolved.error), details: { items: [] } };
        return runSearch({ client: resolved.value }, params, signal);
      },
      renderCall(args, theme) {
        const flags = args.includeDetails ? theme.fg("dim", " +types") : "";
        return new Text(
          `${theme.fg("toolTitle", theme.bold("executor search "))}${theme.fg("accent", args.query)}${flags}`,
          0,
          0,
        );
      },
      renderResult(result, options, theme) {
        return renderSearchResult(result.details, textOf(result), options.expanded, theme);
      },
    }),
  );

  pi.registerTool(
    defineTool<typeof ExecuteParams, ExecuteDetails>({
      ...EXECUTE_TOOL,
      parameters: ExecuteParams,
      annotations: { readOnlyHint: false, openWorldHint: true },
      promptSnippet: "Run TypeScript against Executor's connected tools.",
      promptGuidelines: [
        "Search with executor_search first, then call tools by the full path it returns.",
        "Keep executor_execute snippets focused; return only the fields you need.",
      ],
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const resolved = await resolveClient().then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        if (!resolved.ok) return { ...configFailure(resolved.error), details: { approvals: [] } };
        return runExecute(
          { client: resolved.value, policy: interactivePolicy(ctx) },
          params,
          signal,
        );
      },
      renderCall(args, theme, context) {
        const code = highlightCode(args.code, "typescript");
        const shown = context.expanded ? code : code.slice(0, COLLAPSED_LINES);
        const more =
          code.length > shown.length
            ? [theme.fg("dim", `… ${code.length - shown.length} more lines`)]
            : [];
        return new Text(
          [theme.fg("toolTitle", theme.bold("executor execute")), ...shown, ...more].join("\n"),
          0,
          0,
        );
      },
      renderResult(result, options, theme) {
        return renderExecuteResult(
          result.details,
          textOf(result),
          result.isError === true,
          options.expanded,
          theme,
        );
      },
    }),
  );

  pi.registerCommand("executor", {
    description: "Show the Executor connection and check that the server answers",
    handler: async (_args, ctx) => {
      const options = await Effect.runPromiseExit(ExecutorClient.optionsFromEnv);
      if (Exit.isFailure(options)) {
        ctx.ui.notify(`Executor is not configured: ${String(options.cause)}`, "error");
        return;
      }
      const auth = options.value.access ? "Cloudflare Access token" : "no auth headers";
      const probe = await Effect.runPromiseExit(
        ExecutorClient.create(options.value).search({ query: "list", limit: 1 }),
      );
      if (Exit.isSuccess(probe)) {
        ctx.ui.notify(`Executor ${options.value.baseUrl} (${auth}): reachable`, "info");
        ctx.ui.setStatus("executor", "executor ✓");
      } else {
        ctx.ui.notify(
          `Executor ${options.value.baseUrl} (${auth}): ${String(probe.cause)}`,
          "error",
        );
        ctx.ui.setStatus("executor", "executor ✗");
      }
    },
  });
}
