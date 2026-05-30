import {
  defineTool,
  keyText,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Effect, type ManagedRuntime } from "effect";

import type { AppServices } from "../app/layer.ts";
import type { WebSearchInput } from "../domain/types.ts";
import { formatSearchMarkdown } from "../format/markdown.ts";
import { WebSearchToolInput, type WebSearchToolDetails } from "../schemas/search.ts";
import { WebService } from "../services/web.ts";

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const truncate = (text: string, maxCharacters: number): string => {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxCharacters) {
    return compacted;
  }
  return `${compacted.slice(0, maxCharacters - 1).trimEnd()}…`;
};

export const makeWebSearchTool = (
  runtime: ManagedRuntime.ManagedRuntime<AppServices, never>,
): ToolDefinition<typeof WebSearchToolInput, WebSearchToolDetails> =>
  defineTool({
    name: "web_search",
    label: "Web Search",
    description: `Search the web for any topic and get clean, ready-to-use content.

Best for: Finding current information, news, facts, people, companies, or answering questions about any topic.
Returns: Clean text content from top search results.

Query tips: describe the ideal page, not keywords. Use category:people / category:company in the query when needed. If highlights are insufficient, follow up with web_fetch on the best URLs.`,
    promptSnippet: "Search the web for current information.",
    parameters: WebSearchToolInput,
    promptGuidelines: [
      "Use web_search when you do not know which URL to read.",
      "Write a semantically rich description of the ideal page, not bare keywords.",
      "Use category:people or category:company in the query when searching profiles or companies.",
      "Follow up with web_fetch on the best URLs when highlights are not enough.",
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      try {
        const input = {
          query: params.query,
          searchQueries: params.searchQueries,
          mode: params.mode,
          numResults: params.numResults,
          filters: params.filters,
        } satisfies WebSearchInput;

        const output = await runtime.runPromise(
          WebService.use((web) => web.search(input, ctx.cwd)),
        );

        const compactText = formatSearchMarkdown(output);
        const expandedText = formatSearchMarkdown(output, { expanded: true });

        return {
          content: [{ type: "text", text: compactText }],
          details: {
            provider: output.provider,
            query: output.query,
            hitCount: output.hits.length,
            requestId: output.requestId,
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
            query: params.query,
            hitCount: 0,
          },
          isError: true,
        };
      }
    },
    renderCall(args, theme) {
      const filters = args.filters;
      const params = [
        `mode=${args.mode ?? "standard"}`,
        `results=${args.numResults ?? 10}`,
        args.searchQueries?.length ? `queries=${args.searchQueries.length}` : undefined,
        filters?.category ? `category=${filters.category}` : undefined,
        filters?.includeDomains?.length
          ? `include=${filters.includeDomains.slice(0, 3).join(",")}`
          : undefined,
        filters?.excludeDomains?.length
          ? `exclude=${filters.excludeDomains.slice(0, 3).join(",")}`
          : undefined,
        filters?.startPublishedDate ? `after=${filters.startPublishedDate}` : undefined,
        filters?.endPublishedDate ? `before=${filters.endPublishedDate}` : undefined,
        filters?.location ? `location=${filters.location}` : undefined,
      ].filter((param): param is string => param !== undefined);

      const lines = [
        `${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg(
          "accent",
          truncate(args.query, 140),
        )}`,
      ];
      if (params.length > 0) {
        lines.push(theme.fg("dim", params.join(" | ")));
      }
      if (args.searchQueries?.length) {
        lines.push(
          theme.fg(
            "dim",
            `searchQueries: ${args.searchQueries.map((query) => truncate(query, 80)).join("; ")}`,
          ),
        );
      }

      return new Text(lines.join("\n"), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Searching..."), 0, 0);
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
          theme.bold(`${details?.hitCount ?? 0} result(s) via ${details?.provider ?? "web"}`),
        ),
      ];
      if (body) {
        lines.push("", theme.fg("toolOutput", body));
      }
      if (!expanded && details?.expandedText && details.expandedText !== body) {
        lines.push("", theme.fg("muted", `${keyText("app.tools.expand")} to show full excerpts`));
      }

      return new Text(lines.join("\n"), 0, 0);
    },
  });
