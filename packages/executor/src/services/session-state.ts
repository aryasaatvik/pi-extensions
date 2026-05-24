import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";

export interface SessionSnapshot {
  readonly cwd: string;
  readonly hasUI: boolean;
  readonly model: string | undefined;
}

export class SessionStateService extends Context.Service<
  SessionStateService,
  {
    readonly snapshot: (
      ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "model">,
    ) => Effect.Effect<SessionSnapshot>;
  }
>()("SessionStateService") {
  static readonly Default = Layer.succeed(this)({
    snapshot: (ctx) =>
      Effect.succeed({
        cwd: ctx.cwd,
        hasUI: ctx.hasUI,
        model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
      }),
  });
}
