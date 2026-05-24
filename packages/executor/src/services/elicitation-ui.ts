import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ElicitationContext, ElicitationResponse } from "@executor-js/sdk/core";
import { Context, Effect, Layer, Predicate } from "effect";

import { ElicitationUiError } from "../errors.ts";

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
};

const parseObjectInput = (input: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(input);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Executor form responses must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
};

const hasFormFields = (schema: Record<string, unknown>): boolean => {
  const properties = schema.properties;
  return (
    properties !== null &&
    typeof properties === "object" &&
    !Array.isArray(properties) &&
    Object.keys(properties).length > 0
  );
};

const requestTitle = (elicitation: ElicitationContext): string =>
  `Executor: ${String(elicitation.toolId)}`;

export class ElicitationUiService extends Context.Service<
  ElicitationUiService,
  {
    readonly respond: (
      elicitation: ElicitationContext,
      ctx: ExtensionContext,
    ) => Effect.Effect<ElicitationResponse, ElicitationUiError>;
  }
>()("ElicitationUiService") {
  static readonly Default = Layer.succeed(this)({
    respond: (elicitation, ctx) =>
      Effect.tryPromise({
        try: async () => {
          if (!ctx.hasUI) {
            return { action: "cancel" };
          }

          const req = elicitation.request;
          if (Predicate.isTagged(req, "UrlElicitation")) {
            ctx.ui.notify(`Executor needs browser approval: ${req.url}`, "warning");
            const action = await ctx.ui.select(requestTitle(elicitation), [
              "accept",
              "decline",
              "cancel",
            ]);

            if (action === "accept") return { action: "accept" };
            if (action === "decline") return { action: "decline" };
            return { action: "cancel" };
          }

          if (Predicate.isTagged(req, "FormElicitation")) {
            if (!hasFormFields(req.requestedSchema)) {
              const ok = await ctx.ui.confirm(req.message, `Tool: ${String(elicitation.toolId)}`);
              return { action: ok ? "accept" : "decline" };
            }

            const input = await ctx.ui.input(
              requestTitle(elicitation),
              `JSON object matching schema:\n${formatJson(req.requestedSchema)}`,
            );
            if (input === undefined) return { action: "cancel" };

            return {
              action: "accept",
              content: parseObjectInput(input),
            };
          }

          throw new Error(`Unsupported Executor elicitation shape: ${formatJson(req)}`);
        },
        catch: (cause) =>
          new ElicitationUiError({
            message: "Executor elicitation failed in Pi UI.",
            cause,
          }),
      }),
  });
}
