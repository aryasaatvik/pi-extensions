import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatExecuteResult } from "@executor-js/execution/core";
import { Context, Effect, Layer } from "effect";

import { ExecutionError } from "../errors.ts";
import { prepareExecuteSource } from "../executor/code.ts";
import type { ExecuteDetails, ExecuteInput } from "../schemas/execute.ts";
import { ElicitationUiService } from "./elicitation-ui.ts";
import { ExecutorHostService } from "./executor-host.ts";

export interface ExecuteRequest {
  readonly input: ExecuteInput;
  readonly ctx: ExtensionContext;
}

export interface ExecuteResponse {
  readonly text: string;
  readonly details: ExecuteDetails;
  readonly isError: boolean;
}

export class ExecutionService extends Context.Service<
  ExecutionService,
  {
    readonly execute: (
      request: ExecuteRequest,
    ) => Effect.Effect<ExecuteResponse, ExecutionError, ExecutorHostService | ElicitationUiService>;
  }
>()("ExecutionService") {
  static readonly Default = Layer.succeed(this)({
    execute: (request) =>
      Effect.gen(function* () {
        const hosts = yield* ExecutorHostService;
        const elicitation = yield* ElicitationUiService;
        const host = yield* hosts.get(request.ctx.cwd).pipe(
          Effect.mapError(
            (cause) =>
              new ExecutionError({
                message: cause.message,
                cause,
              }),
          ),
        );
        const code = prepareExecuteSource(request.input.code);
        const result = yield* host.engine
          .execute(code, {
            onElicitation: (ctx) =>
              elicitation
                .respond(ctx, request.ctx)
                .pipe(Effect.catch(() => Effect.succeed({ action: "cancel" as const }))),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ExecutionError({
                  message: "Executor code execution failed.",
                  cause,
                }),
            ),
          );
        const formatted = formatExecuteResult(result);

        return {
          text: formatted.text,
          details: formatted.structured as ExecuteDetails,
          isError: formatted.isError,
        };
      }),
  });
}
