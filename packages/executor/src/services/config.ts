import { Context, Effect, Layer } from "effect";

import { formatDisplayModeLabel } from "../config/display-presets.ts";
import {
  formatExecutorPiSettingsSummary,
  loadExecutorPiSettings,
  saveGlobalExecutorPiSettings,
  saveProjectExecutorPiSettings,
} from "../config/store.ts";
import type { ExecutorSettings } from "../schemas/settings.ts";

export interface ResolvedConfig {
  readonly cwd: string;
  readonly settings: ExecutorSettings;
}

export class ConfigService extends Context.Service<
  ConfigService,
  {
    readonly resolve: (cwd: string) => Effect.Effect<ResolvedConfig>;
    readonly saveGlobal: (settings: ExecutorSettings) => Effect.Effect<void, Error>;
    readonly saveProject: (cwd: string, settings: ExecutorSettings) => Effect.Effect<void, Error>;
    readonly formatSettingsSummary: (settings: ExecutorSettings) => string;
    readonly formatStatusBar: (settings: ExecutorSettings) => string;
  }
>()("ConfigService") {
  static readonly Default = Layer.succeed(this)({
    resolve: (cwd) =>
      loadExecutorPiSettings(cwd).pipe(Effect.map((settings) => ({ cwd, settings }))),
    saveGlobal: saveGlobalExecutorPiSettings,
    saveProject: saveProjectExecutorPiSettings,
    formatSettingsSummary: formatExecutorPiSettingsSummary,
    formatStatusBar: (settings) => `executor: ${formatDisplayModeLabel(settings.displayMode)}`,
  });
}
