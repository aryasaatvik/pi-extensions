import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Effect, type ManagedRuntime } from "effect";

import type { AppServices } from "../app/layer.ts";
import { SearchInput, type SearchDetails } from "../schemas/search.ts";
import { RenderService } from "../services/render.ts";
import { SearchService } from "../services/search.ts";

export const makeSearchTool = (
  runtime: ManagedRuntime.ManagedRuntime<AppServices, never>,
): ToolDefinition<typeof SearchInput, SearchDetails> =>
  defineTool({
    name: "search",
    label: "Search",
    description:
      "Search Executor's configured tool catalog for the current project. Use this before execute when you need available namespaces, tool paths, descriptions, or compact TypeScript shapes. This does not execute external tools.",
    promptSnippet: "Search Executor's configured project tool catalog.",
    parameters: Type.Object({
      query: SearchInput.properties.query,
      namespace: SearchInput.properties.namespace,
      limit: SearchInput.properties.limit,
      offset: SearchInput.properties.offset,
      includeDetails: SearchInput.properties.includeDetails,
    }),
    promptGuidelines: [
      "Use search before execute when the Executor tool path or input shape is unknown.",
      "Use short intent phrases such as github issues, repo details, or create calendar event.",
      "Set includeDetails when you need compact TypeScript input/output shapes before writing Executor code.",
      "Search returns a paged result object with items, total, hasMore, and nextOffset; inspect items before choosing a tool path.",
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      try {
        const result = await runtime.runPromise(
          SearchService.use((search) =>
            search.search({
              input: params,
              ctx,
            }),
          ),
        );

        return {
          content: [{ type: "text", text: result.text }],
          details: result.details,
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return {
          content: [{ type: "text", text: message }],
          details: { items: [], total: 0, hasMore: false, nextOffset: null },
          isError: true,
        };
      }
    },
    renderCall(args, theme, context) {
      return runtime.runSync(
        RenderService.use((render) => render.renderSearchCall(context.cwd, args, theme)),
      );
    },
    renderResult(result, options, theme, context) {
      const content = result.content[0];
      const text = content?.type === "text" ? content.text : "";

      return runtime.runSync(
        RenderService.use((render) =>
          render.renderSearchResult(context.cwd, result.details, text, options, theme),
        ),
      );
    },
  });
