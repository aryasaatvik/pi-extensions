import { Context, Effect, Layer } from "effect";

import {
  formatSubagentsSettingsSummary,
  loadSubagentsSettings,
  saveGlobalSubagentsSettings,
  saveProjectSubagentsSettings,
} from "../config/store.ts";
import type { SubagentsConfigError } from "../domain/errors.ts";
import type { SubagentsSettings } from "../schemas/settings.ts";

export class SubagentsConfigService extends Context.Service<
  SubagentsConfigService,
  {
    readonly resolve: (cwd: string) => Effect.Effect<SubagentsSettings>;
    readonly saveGlobal: (settings: SubagentsSettings) => Effect.Effect<void, SubagentsConfigError>;
    readonly saveProject: (
      cwd: string,
      settings: SubagentsSettings,
    ) => Effect.Effect<void, SubagentsConfigError>;
    readonly formatSummary: (settings: SubagentsSettings) => string;
  }
>()("@pi-subagents/SubagentsConfigService") {
  static readonly Default = Layer.succeed(this)({
    resolve: loadSubagentsSettings,
    saveGlobal: saveGlobalSubagentsSettings,
    saveProject: saveProjectSubagentsSettings,
    formatSummary: formatSubagentsSettingsSummary,
  });
}
