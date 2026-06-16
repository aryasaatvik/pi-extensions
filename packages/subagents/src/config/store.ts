import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Effect, Option, Schema } from "effect";

import { SubagentsConfigError } from "../domain/errors.ts";
import {
  DefaultSubagentsSettings,
  SubagentsSettings,
  type SubagentsSettings as Settings,
} from "../schemas/settings.ts";
import { globalSubagentsConfigPath, projectSubagentsConfigPath } from "./paths.ts";

const mergeSettings = (base: Settings, override: Partial<Settings> | undefined): Settings => {
  if (!override) return base;
  return {
    maxConcurrentPerSession: override.maxConcurrentPerSession ?? base.maxConcurrentPerSession,
    maxConcurrentGlobal: override.maxConcurrentGlobal ?? base.maxConcurrentGlobal,
    outputCapBytes: override.outputCapBytes ?? base.outputCapBytes,
    defaultModel: override.defaultModel ?? base.defaultModel,
  };
};

const decodeJson = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);
const encodeSettingsJson = Schema.encodeEffect(Schema.fromJsonString(SubagentsSettings));

const readConfigFile = (path: string): Effect.Effect<Partial<Settings> | undefined, never> =>
  Effect.gen(function* () {
    if (!existsSync(path)) return undefined;

    const raw = yield* Effect.try({
      try: () => readFileSync(path, "utf-8"),
      catch: (cause) =>
        new SubagentsConfigError({ message: `Failed to read subagents config at ${path}`, cause }),
    }).pipe(Effect.option);
    if (Option.isNone(raw)) return undefined;

    const parsed = yield* decodeJson(raw.value).pipe(Effect.option);
    if (Option.isNone(parsed)) return undefined;

    const value = parsed.value;
    return typeof value === "object" && value !== null ? (value as Partial<Settings>) : undefined;
  });

const writeConfigFile = (
  path: string,
  settings: Settings,
): Effect.Effect<void, SubagentsConfigError> =>
  Effect.gen(function* () {
    const json = yield* encodeSettingsJson(settings).pipe(
      Effect.mapError(
        (cause) =>
          new SubagentsConfigError({
            message: `Failed to encode subagents config for ${path}`,
            cause,
          }),
      ),
    );

    yield* Effect.try({
      try: () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${json}\n`, "utf-8");
      },
      catch: (cause) =>
        new SubagentsConfigError({ message: `Failed to write subagents config at ${path}`, cause }),
    });
  });

export const loadSubagentsSettings = (cwd: string): Effect.Effect<Settings, never> =>
  Effect.gen(function* () {
    const global = yield* readConfigFile(globalSubagentsConfigPath());
    const project = yield* readConfigFile(projectSubagentsConfigPath(cwd));
    const base = mergeSettings(DefaultSubagentsSettings, global);
    return mergeSettings(base, project);
  });

export const saveGlobalSubagentsSettings = (
  settings: Settings,
): Effect.Effect<void, SubagentsConfigError> =>
  writeConfigFile(globalSubagentsConfigPath(), settings);

export const saveProjectSubagentsSettings = (
  cwd: string,
  settings: Settings,
): Effect.Effect<void, SubagentsConfigError> =>
  writeConfigFile(projectSubagentsConfigPath(cwd), settings);

export const formatSubagentsSettingsSummary = (settings: Settings): string =>
  [
    "Pi Subagents settings",
    `maxConcurrentPerSession: ${settings.maxConcurrentPerSession}`,
    `maxConcurrentGlobal: ${settings.maxConcurrentGlobal}`,
    `outputCapBytes: ${settings.outputCapBytes}`,
    `defaultModel: ${settings.defaultModel ?? "(inherit parent)"}`,
    `global: ${globalSubagentsConfigPath()}`,
  ].join("\n");
