// `executor_search` and `executor_execute` as pi-agent-core tools.
//
// Effect stays inside: each tool call runs one Effect program to a Promise at
// Pi's edge, interrupted by the call's AbortSignal. Failures come back as
// `isError` results (never throws) so every call also lands in the trace.

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Cause, Effect, Exit, Option } from "effect";
import { Type, type Static } from "typebox";

import type * as ExecutorClient from "./client.ts";
import {
  ExecutorResumeLimitError,
  type ExecutorApprovalError,
  type ExecutorError,
} from "./errors.ts";
import { decide, type ApprovalPolicy } from "./policy.ts";
import type {
  CompletedExecution,
  CompletedOutcome,
  ResumeAction,
  SearchItem,
  ToolCall,
} from "./schemas.ts";

/** Approvals one `executor_execute` call may answer before it gives up. */
const MAX_RESUMES = 20;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const DESCRIBE_CONCURRENCY = 4;
const SUMMARY_CHARS = 200;

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

/** An approval the policy answered during one execution. */
export interface ApprovalRecord {
  readonly address: string;
  readonly kind: "url" | "form";
  readonly message: string;
  readonly action: ResumeAction;
}

/** One record per tool call, success or failure. */
export type ExecutorTraceRecord =
  | {
      readonly kind: "search";
      readonly query: string;
      /** The hits, or the error message when `isError`. */
      readonly result: ReadonlyArray<SearchHit> | string;
      readonly isError: boolean;
      readonly durationMs: number;
    }
  | {
      readonly kind: "execute";
      readonly code: string;
      /** The script's return value, the script error, or the request error message. */
      readonly result: unknown;
      readonly isError: boolean;
      /** Present once the Executor server reports tool calls on completed executions. */
      readonly toolCalls?: ReadonlyArray<ToolCall>;
      readonly approvals: ReadonlyArray<ApprovalRecord>;
      readonly durationMs: number;
    };

/** An array to append to, or a callback per record. */
export type ExecutorTraceSink =
  | Array<ExecutorTraceRecord>
  | ((record: ExecutorTraceRecord) => void);

const record = (sink: ExecutorTraceSink | undefined, entry: ExecutorTraceRecord): void => {
  if (sink === undefined) return;
  if (Array.isArray(sink)) sink.push(entry);
  else sink(entry);
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const SearchParams = Type.Object({
  query: Type.String({
    description:
      "Short intent phrase, such as 'list repository issues' or 'create calendar event'.",
  }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_SEARCH_LIMIT,
      description: `Maximum matches. Defaults to ${DEFAULT_SEARCH_LIMIT}.`,
    }),
  ),
  includeDetails: Type.Optional(
    Type.Boolean({
      description:
        "Include each match's TypeScript input and output types. Use before calling an unfamiliar tool.",
    }),
  ),
});
export type SearchParams = Static<typeof SearchParams>;

const SearchHitSchema = Type.Object({
  path: Type.String(),
  name: Type.String(),
  integration: Type.String(),
  score: Type.Number(),
  description: Type.Optional(Type.String()),
  inputTypeScript: Type.Optional(Type.String()),
  outputTypeScript: Type.Optional(Type.String()),
  typeScriptDefinitions: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export const SearchOutput = Type.Object({ items: Type.Array(SearchHitSchema) });

export interface SearchHit extends SearchItem {
  readonly inputTypeScript?: string;
  readonly outputTypeScript?: string;
  readonly typeScriptDefinitions?: Readonly<Record<string, string>>;
}

export interface SearchDetails {
  readonly items: ReadonlyArray<SearchHit>;
}

export const SEARCH_TOOL = {
  name: "executor_search",
  label: "Executor search",
  description: [
    "Search the Executor tool catalog (connected APIs such as GitHub, Google, Linear) by intent.",
    "Returns callable paths for executor_execute code, e.g. tools.github_api.org.acme.issues.listForRepo.",
    "Set includeDetails to get TypeScript input/output types before calling an unfamiliar tool.",
    "Does not call any tool.",
  ].join(" "),
} as const;

/**
 * Keep only the named definitions the input and output types reach, so a
 * detail request does not dump a whole API's type catalog.
 */
export const reachableDefinitions = (
  roots: ReadonlyArray<string>,
  definitions: Readonly<Record<string, string>>,
): Record<string, string> => {
  const reached: Record<string, string> = {};
  const pending = [...roots];
  while (pending.length > 0) {
    const source = pending.pop() ?? "";
    for (const [name, body] of Object.entries(definitions)) {
      if (name in reached || !new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`).test(source))
        continue;
      reached[name] = body;
      pending.push(body);
    }
  }
  return reached;
};

const summary = (description: string | undefined): string | undefined => {
  if (!description) return undefined;
  const paragraph = (description.split(/\n\s*\n/).find((part) => part.trim()) ?? description)
    .replace(/\s+/g, " ")
    .trim();
  return paragraph.length <= SUMMARY_CHARS
    ? paragraph
    : `${paragraph.slice(0, SUMMARY_CHARS - 1)}…`;
};

export const searchText = (items: ReadonlyArray<SearchHit>): string => {
  if (items.length === 0)
    return "No matching Executor tools. Try a broader or differently worded query.";
  const lines = [
    `${items.length} match${items.length === 1 ? "" : "es"}. Call inside executor_execute as tools.<path>(input).`,
  ];
  // Hits from one API share most definitions; print each once.
  const definitions = new Map<string, string>();
  for (const item of items) {
    const description = summary(item.description);
    lines.push("", `tools.${item.path}${description ? ` — ${description}` : ""}`);
    if (item.inputTypeScript) lines.push(`  input: ${item.inputTypeScript}`);
    if (item.outputTypeScript) lines.push(`  output: ${item.outputTypeScript}`);
    for (const [name, body] of Object.entries(item.typeScriptDefinitions ?? {}))
      definitions.set(name, body);
  }
  if (definitions.size > 0) {
    lines.push("", "Types:");
    for (const [name, body] of definitions) lines.push(`type ${name} = ${body}`);
  }
  return lines.join("\n");
};

export const search = (
  client: ExecutorClient.Interface,
  params: SearchParams,
): Effect.Effect<ReadonlyArray<SearchHit>, ExecutorError> =>
  Effect.gen(function* () {
    const items = yield* client.search({
      query: params.query,
      limit: params.limit ?? DEFAULT_SEARCH_LIMIT,
    });
    if (!params.includeDetails) return items;
    return yield* Effect.forEach(
      items,
      (item) =>
        client.describe(item.path).pipe(
          Effect.map((view): SearchHit => {
            const roots = [view.inputTypeScript ?? "", view.outputTypeScript ?? ""];
            const definitions = reachableDefinitions(roots, view.typeScriptDefinitions ?? {});
            return {
              ...item,
              ...(view.inputTypeScript === undefined
                ? {}
                : { inputTypeScript: view.inputTypeScript }),
              ...(view.outputTypeScript === undefined
                ? {}
                : { outputTypeScript: view.outputTypeScript }),
              ...(Object.keys(definitions).length === 0
                ? {}
                : { typeScriptDefinitions: definitions }),
            };
          }),
        ),
      { concurrency: DESCRIBE_CONCURRENCY },
    );
  });

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export const ExecuteParams = Type.Object({
  code: Type.String({
    description:
      "TypeScript to run in Executor's sandbox. Call tools as `await tools.<path>(input)` and end with a top-level `return`.",
  }),
});
export type ExecuteParams = Static<typeof ExecuteParams>;

export interface ExecuteDetails {
  /** The execution's final outcome; absent when the request itself failed. */
  readonly outcome?: CompletedOutcome;
  readonly approvals: ReadonlyArray<ApprovalRecord>;
  readonly toolCalls?: ReadonlyArray<ToolCall>;
}

export const EXECUTE_TOOL = {
  name: "executor_execute",
  label: "Executor execute",
  description: [
    "Run a TypeScript snippet in Executor's server-side sandbox against connected tools (third-party APIs with stored credentials).",
    "Find tool paths with executor_search first; call them by full path, e.g. `await tools.github_api.org.acme.issues.listForRepo({ owner, repo })`.",
    "A tool call resolves to `{ ok, data, error?, http }`: check `ok` and read `data`.",
    "Use a top-level `return` for the value you need; a bare final expression returns nothing. `console.log` output comes back as logs.",
    "Return compact structured JSON: select the fields you need rather than whole API responses.",
    "There is no `fetch` or network access; only `tools.*`.",
    "Some calls need approval; denied approvals surface as tool errors.",
  ].join(" "),
} as const;

export interface ExecuteOutcome {
  readonly execution: CompletedExecution;
  readonly approvals: ReadonlyArray<ApprovalRecord>;
}

/**
 * Run code and answer every pause through `policy` until it completes.
 * `approvals` receives each answer as it is given, so a caller can still
 * report them when a later resume fails.
 */
export const execute = (
  client: ExecutorClient.Interface,
  code: string,
  policy: ApprovalPolicy,
  approvals: Array<ApprovalRecord> = [],
): Effect.Effect<
  ExecuteOutcome,
  ExecutorError | ExecutorResumeLimitError | ExecutorApprovalError
> =>
  Effect.gen(function* () {
    let response = yield* client.execute(code);
    while (response.status === "paused") {
      const { executionId, expiresAt, interaction } = response.structured;
      if (approvals.length >= MAX_RESUMES) {
        return yield* new ExecutorResumeLimitError({ executionId, resumes: approvals.length });
      }
      const answer = yield* decide(policy, {
        ...interaction,
        executionId,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });
      approvals.push({
        address: interaction.address,
        kind: interaction.kind,
        message: interaction.message,
        action: answer.action,
      });
      response = yield* client.resume(executionId, answer);
    }
    return { execution: response, approvals };
  });

const outcomeValue = (outcome: CompletedOutcome): unknown => {
  switch (outcome.status) {
    case "completed":
      return outcome.result;
    case "error":
      return outcome.error;
    case "declined":
      return outcome;
  }
};

export const executeText = ({
  approvals,
  text,
}: {
  readonly approvals: ReadonlyArray<ApprovalRecord>;
  readonly text: string;
}): string => {
  const answered = approvals.map(
    (approval) => `Approval ${approval.action}: ${approval.address} — ${approval.message}`,
  );
  return answered.length === 0 ? text : [...answered, "", text].join("\n");
};

// ---------------------------------------------------------------------------
// Tool set
// ---------------------------------------------------------------------------

export interface ExecutorToolsOptions {
  readonly client: ExecutorClient.Interface;
  /** How paused executions are answered. Headless callers usually pass `"decline"`. */
  readonly policy: ApprovalPolicy;
  readonly trace?: ExecutorTraceSink;
}

const failureText = (cause: Cause.Cause<{ readonly message: string }>): string => {
  const error = Cause.findErrorOption(cause);
  return Option.isSome(error) ? error.value.message : Cause.pretty(cause);
};

/** Run one search, record it, and shape the agent result. */
export const runSearch = async (
  options: Pick<ExecutorToolsOptions, "client" | "trace">,
  params: SearchParams,
  signal: AbortSignal | undefined,
): Promise<AgentToolResult<SearchDetails>> => {
  const started = performance.now();
  const exit = await Effect.runPromiseExit(search(options.client, params), { signal });
  const durationMs = Math.round(performance.now() - started);
  if (Exit.isSuccess(exit)) {
    const items = exit.value;
    record(options.trace, {
      kind: "search",
      query: params.query,
      result: items,
      isError: false,
      durationMs,
    });
    return {
      content: [{ type: "text", text: searchText(items) }],
      details: { items },
      structuredContent: { items: items.map((item) => ({ ...item })) },
    };
  }
  const message = failureText(exit.cause);
  record(options.trace, {
    kind: "search",
    query: params.query,
    result: message,
    isError: true,
    durationMs,
  });
  return {
    content: [{ type: "text", text: `Executor search failed: ${message}` }],
    details: { items: [] },
    isError: true,
  };
};

/** Run one execution under a policy, record it, and shape the agent result. */
export const runExecute = async (
  options: ExecutorToolsOptions,
  params: ExecuteParams,
  signal: AbortSignal | undefined,
): Promise<AgentToolResult<ExecuteDetails>> => {
  const started = performance.now();
  const answered: ApprovalRecord[] = [];
  const exit = await Effect.runPromiseExit(
    execute(options.client, params.code, options.policy, answered),
    { signal },
  );
  const durationMs = Math.round(performance.now() - started);
  if (Exit.isSuccess(exit)) {
    const { execution, approvals } = exit.value;
    record(options.trace, {
      kind: "execute",
      code: params.code,
      result: outcomeValue(execution.structured),
      isError: execution.isError,
      ...(execution.toolCalls === undefined ? {} : { toolCalls: execution.toolCalls }),
      approvals,
      durationMs,
    });
    return {
      content: [{ type: "text", text: executeText({ approvals, text: execution.text }) }],
      details: {
        outcome: execution.structured,
        approvals,
        ...(execution.toolCalls === undefined ? {} : { toolCalls: execution.toolCalls }),
      },
      isError: execution.isError,
    };
  }
  const message = failureText(exit.cause);
  record(options.trace, {
    kind: "execute",
    code: params.code,
    result: message,
    isError: true,
    approvals: answered,
    durationMs,
  });
  return {
    content: [
      {
        type: "text",
        text: executeText({ approvals: answered, text: `Executor execution failed: ${message}` }),
      },
    ],
    details: { approvals: answered },
    isError: true,
  };
};

/** The Executor tools for a pi-agent-core `Agent`. */
export const executorTools = (
  options: ExecutorToolsOptions,
): [
  AgentTool<typeof SearchParams, SearchDetails>,
  AgentTool<typeof ExecuteParams, ExecuteDetails>,
] => [
  {
    ...SEARCH_TOOL,
    parameters: SearchParams,
    outputSchema: SearchOutput,
    replay: "safe",
    executionMode: "parallel",
    execute: (_toolCallId, params, signal) => runSearch(options, params, signal),
  },
  {
    ...EXECUTE_TOOL,
    parameters: ExecuteParams,
    // A replayed script may repeat a third-party write.
    replay: "never",
    execute: (_toolCallId, params, signal) => runExecute(options, params, signal),
  },
];
