import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Effect, Schema } from "effect";

import { normalizeExecutorSettings } from "./display-presets.ts";
import { globalExecutorPiConfigPath, projectExecutorPiConfigPath } from "./paths.ts";
import {
  DefaultExecutorSettings,
  ExecutorSettings,
  type ExecutorSettings as ExecutorSettingsType,
} from "../schemas/settings.ts";

const mergeSettings = (
  base: ExecutorSettingsType,
  override: Partial<ExecutorSettingsType> | undefined,
): ExecutorSettingsType => {
  if (!override) {
    return base;
  }

  return normalizeExecutorSettings({
    displayMode: override.displayMode ?? base.displayMode,
    render: { ...base.render, ...override.render },
    search: { ...base.search, ...override.search },
  });
};

const readConfigFile = (path: string): Effect.Effect<ExecutorSettingsType | undefined, never> =>
  Effect.sync(() => {
    if (!existsSync(path)) {
      return undefined;
    }

    try {
      const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
      return normalizeExecutorSettings(Schema.decodeUnknownSync(ExecutorSettings)(raw));
    } catch {
      return undefined;
    }
  });

const writeConfigFile = (
  path: string,
  settings: ExecutorSettingsType,
): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(`Failed to write Executor Pi config at ${path}`),
  });

export const loadExecutorPiSettings = (cwd: string): Effect.Effect<ExecutorSettingsType, never> =>
  Effect.gen(function* () {
    const global = yield* readConfigFile(globalExecutorPiConfigPath());
    const project = yield* readConfigFile(projectExecutorPiConfigPath(cwd));
    const base = global ?? DefaultExecutorSettings;
    return mergeSettings(base, project);
  });

export const saveGlobalExecutorPiSettings = (
  settings: ExecutorSettingsType,
): Effect.Effect<void, Error> =>
  writeConfigFile(globalExecutorPiConfigPath(), normalizeExecutorSettings(settings));

export const saveProjectExecutorPiSettings = (
  cwd: string,
  settings: ExecutorSettingsType,
): Effect.Effect<void, Error> =>
  writeConfigFile(projectExecutorPiConfigPath(cwd), normalizeExecutorSettings(settings));

export const formatExecutorPiSettingsSummary = (settings: ExecutorSettingsType): string => {
  const lines = [
    "Pi Executor settings",
    `displayMode: ${settings.displayMode}`,
    `maxCodePreviewLines: ${settings.render.maxCodePreviewLines}`,
    `maxJsonBytes: ${settings.render.maxJsonBytes}`,
    `maxLogLines: ${settings.render.maxLogLines}`,
    `search.defaultIncludeDetails: ${settings.search.defaultIncludeDetails}`,
    `search.showSourcesFooter: ${settings.search.showSourcesFooter}`,
    `search.mode: ${settings.search.mode}`,
    `search.embeddings: ${
      settings.search.embeddings
        ? `${settings.search.embeddings.provider} ${settings.search.embeddings.model} (${settings.search.embeddings.dimensions})`
        : "not configured"
    }`,
    `global: ${globalExecutorPiConfigPath()}`,
  ];

  return lines.join("\n");
};
