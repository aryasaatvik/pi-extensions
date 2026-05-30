import {
  defineTool,
  keyText,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Effect, type ManagedRuntime } from "effect";

import type { AppServices } from "../app/layer.ts";
import type { WebFetchInput } from "../domain/types.ts";
import {
  fetchHasSuccessfulContent,
  formatFetchAllErrors,
  formatFetchMarkdown,
} from "../format/markdown.ts";
import { WebFetchToolInput, type WebFetchToolDetails } from "../schemas/fetch.ts";
import { WebService } from "../services/web.ts";
import { normalizeUrls } from "../utils/normalize-urls.ts";

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const truncate = (text: string, maxCharacters: number): string => {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxCharacters) {
    return compacted;
  }
  return `${compacted.slice(0, maxCharacters - 1).trimEnd()}…`;
};

export const makeWebFetchTool = (
  runtime: ManagedRuntime.ManagedRuntime<AppServices, never>,
): ToolDefinition<typeof WebFetchToolInput, WebFetchToolDetails> =>
  defineTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: `Read a webpage's full content as clean text. Use after web_search when highlights are insufficient or to read any URL.

Best for: Extracting full content from known URLs. Batch multiple URLs in one call.
Returns: Clean text content and metadata from the page(s).`,
    promptSnippet: "Fetch full page text from known URLs.",
    parameters: WebFetchToolInput,
    promptGuidelines: [
      "Use web_fetch only when you already have URLs.",
      "Batch multiple URLs in one call when comparing sources.",
    ],
    prepareArguments: (args) => {
      const raw = args as Record<string, unknown>;
      const urls = normalizeUrls(raw.urls);
      if (urls.length === 0) {
        throw new Error("urls must contain at least one HTTP(S) URL");
      }
      return {
        urls,
        target: typeof raw.target === "string" ? raw.target : undefined,
        maxCharacters: typeof raw.maxCharacters === "number" ? raw.maxCharacters : undefined,
        freshness:
          raw.freshness === "cached" || raw.freshness === "fresh" || raw.freshness === "auto"
            ? raw.freshness
            : undefined,
      };
    },
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      try {
        const input = {
          urls: params.urls,
          target: params.target,
          maxCharacters: params.maxCharacters,
          freshness: params.freshness,
        } satisfies WebFetchInput;

        const output = await runtime.runPromise(
          WebService.use((web) => web.fetch(input, ctx.cwd)),
        );

        if (!fetchHasSuccessfulContent(output)) {
          return {
            content: [{ type: "text", text: formatFetchAllErrors(output) }],
            details: {
              provider: output.provider,
              urlCount: output.pages.length,
              searchTime: output.searchTime,
              compactText: formatFetchAllErrors(output),
              expandedText: formatFetchAllErrors(output),
            },
            isError: true,
          };
        }

        const compactText = formatFetchMarkdown(output);
        const expandedText = formatFetchMarkdown(output, { expanded: true });

        return {
          content: [{ type: "text", text: compactText }],
          details: {
            provider: output.provider,
            urlCount: output.pages.length,
            searchTime: output.searchTime,
            compactText,
            expandedText,
          },
        };
      } catch (cause) {
        return {
          content: [{ type: "text", text: errorMessage(cause) }],
          details: {
            provider: "exa",
            urlCount: 0,
          },
          isError: true,
        };
      }
    },
    renderCall(args, theme) {
      const params = [
        `urls=${args.urls.length}`,
        args.freshness ? `freshness=${args.freshness}` : undefined,
        args.maxCharacters ? `maxChars=${args.maxCharacters}` : undefined,
        args.target ? `target=${truncate(args.target, 100)}` : undefined,
      ].filter((param): param is string => param !== undefined);
      const lines = [
        theme.fg("toolTitle", theme.bold("web_fetch")),
        theme.fg("accent", args.urls.slice(0, 3).join("\n")),
      ];
      if (args.urls.length > 3) {
        lines.push(theme.fg("dim", `... ${args.urls.length - 3} more URL(s)`));
      }
      if (params.length > 0) {
        lines.push(theme.fg("dim", params.join(" | ")));
      }

      return new Text(lines.join("\n"), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Fetching..."), 0, 0);
      }

      const details = result.details;
      const content = result.content[0];
      const fallbackText = content?.type === "text" ? content.text : "";
      const body = expanded
        ? (details?.expandedText ?? fallbackText)
        : (details?.compactText ?? fallbackText);
      const lines = [
        theme.fg(
          "success",
          theme.bold(`${details?.urlCount ?? 0} page(s) via ${details?.provider ?? "web"}`),
        ),
      ];
      if (body) {
        lines.push("", theme.fg("toolOutput", body));
      }
      if (!expanded && details?.expandedText && details.expandedText !== body) {
        lines.push("", theme.fg("muted", `${keyText("app.tools.expand")} to show full content`));
      }

      return new Text(lines.join("\n"), 0, 0);
    },
  });
