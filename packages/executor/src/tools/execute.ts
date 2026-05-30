import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Effect, type ManagedRuntime } from "effect";

import { ExecuteInput, type ExecuteDetails } from "../schemas/execute.ts";
import type { AppServices } from "../app/layer.ts";
import { ExecutionService } from "../services/execution.ts";
import { RenderService } from "../services/render.ts";

export const makeExecuteTool = (
  runtime: ManagedRuntime.ManagedRuntime<AppServices, never>,
): ToolDefinition<typeof ExecuteInput, ExecuteDetails> =>
  defineTool({
    name: "execute",
    label: "Execute",
    description:
      "Execute TypeScript in Executor's sandbox for the current project, with access to configured Executor tools, sources, secrets, policies, and Pi-native elicitation. Use search first when you need to discover tool paths or input shapes.",
    promptSnippet: "Run Executor TypeScript against configured project tools.",
    parameters: Type.Object({
      code: ExecuteInput.properties.code,
    }),
    promptGuidelines: [
      "Use execute for Executor TypeScript snippets that need configured Executor tools, sources, secrets, or policies.",
      "Use search first when the Executor tool path or input shape is unknown.",
      "Inside execute code, use tools.search({ query, limit }) and tools.describe.tool({ path }) for sandbox-local discovery.",
      "Inside Executor code, call tools by full namespace path, such as tools.github.getRepositoryDetails(input).",
      "Use a top-level return statement for the value Pi should receive; bare final expressions execute but return null.",
      "Keep snippets focused and return structured JSON when the result will be inspected by Pi.",
      "Do not use fetch; use configured Executor tools.",
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      try {
        const result = await runtime.runPromise(
          ExecutionService.use((execution) =>
            execution.execute({
              input: params,
              ctx,
            }),
          ),
        );

        return {
          content: [{ type: "text", text: result.text }],
          details: result.details,
          isError: result.isError,
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return {
          content: [{ type: "text", text: message }],
          details: { status: "error", error: message, logs: [] },
          isError: true,
        };
      }
    },
    renderCall(args, theme, context) {
      return runtime.runSync(
        RenderService.use((render) =>
          render.renderExecuteCall(context.cwd, args, theme),
        ),
      );
    },
    renderResult(result, options, theme, context) {
      const content = result.content[0];
      const text = content?.type === "text" ? content.text : "";

      return runtime.runSync(
        RenderService.use((render) =>
          render.renderExecuteResult(context.cwd, result.details, text, options, theme),
        ),
      );
    },
  });
