import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Effect, Option, Schema } from "effect";

import { globalPiWebConfigPath, projectPiWebConfigPath } from "./paths.ts";
import { WebConfigError } from "../domain/errors.ts";
import {
  DefaultWebSettings,
  WebSettings,
  type WebSettings as WebSettingsType,
} from "../schemas/settings.ts";

const mergeSettings = (
  base: WebSettingsType,
  override: Partial<WebSettingsType> | undefined,
): WebSettingsType => {
  if (!override) return base;

  return {
    provider: override.provider ?? base.provider,
    caps: { ...base.caps, ...override.caps },
    exa: {
      search: { ...base.exa.search, ...override.exa?.search },
      fetch: { ...base.exa.fetch, ...override.exa?.fetch },
    },
    parallel: {
      search: { ...base.parallel.search, ...override.parallel?.search },
      fetch: { ...base.parallel.fetch, ...override.parallel?.fetch },
    },
  };
};

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeSettingsJson = Schema.encodeEffect(Schema.fromJsonString(WebSettings));

const readConfigFile = (path: string): Effect.Effect<Partial<WebSettingsType> | undefined, never> =>
  Effect.gen(function* () {
    if (!existsSync(path)) return undefined;

    const raw = yield* Effect.try({
      try: () => readFileSync(path, "utf-8"),
      catch: (cause) =>
        new WebConfigError({
          message: `Failed to read pi-web config at ${path}`,
          cause,
        }),
    }).pipe(Effect.option);
    if (Option.isNone(raw)) return undefined;

    const parsed = yield* decodeJson(raw.value).pipe(Effect.option);
    if (Option.isNone(parsed)) return undefined;

    const value = parsed.value;
    return typeof value === "object" && value !== null
      ? (value as Partial<WebSettingsType>)
      : undefined;
  });

const writeConfigFile = (
  path: string,
  settings: WebSettingsType,
): Effect.Effect<void, WebConfigError> =>
  Effect.gen(function* () {
    const json = yield* encodeSettingsJson(settings).pipe(
      Effect.mapError(
        (cause) =>
          new WebConfigError({
            message: `Failed to encode pi-web config for ${path}`,
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
        new WebConfigError({
          message: `Failed to write pi-web config at ${path}`,
          cause,
        }),
    });
  });

export const loadPiWebSettings = (cwd: string): Effect.Effect<WebSettingsType, never> =>
  Effect.gen(function* () {
    const global = yield* readConfigFile(globalPiWebConfigPath());
    const project = yield* readConfigFile(projectPiWebConfigPath(cwd));
    const base = mergeSettings(DefaultWebSettings, global);
    return yield* Schema.decodeUnknownEffect(WebSettings)(mergeSettings(base, project)).pipe(
      Effect.orElseSucceed(() => base),
    );
  });

export const saveGlobalPiWebSettings = (
  settings: WebSettingsType,
): Effect.Effect<void, WebConfigError> => writeConfigFile(globalPiWebConfigPath(), settings);

export const saveProjectPiWebSettings = (
  cwd: string,
  settings: WebSettingsType,
): Effect.Effect<void, WebConfigError> => writeConfigFile(projectPiWebConfigPath(cwd), settings);

export const formatPiWebSettingsSummary = (settings: WebSettingsType): string =>
  [
    "Pi Web settings",
    `provider: ${settings.provider}`,
    `caps.defaultNumResults: ${settings.caps.defaultNumResults}`,
    `caps.maxNumResults: ${settings.caps.maxNumResults}`,
    `caps.maxFetchUrls: ${settings.caps.maxFetchUrls}`,
    `caps.defaultFetchMaxCharacters: ${settings.caps.defaultFetchMaxCharacters}`,
    `caps.maxFetchMaxCharacters: ${settings.caps.maxFetchMaxCharacters}`,
    `caps.allowDeepSearch: ${settings.caps.allowDeepSearch}`,
    `exa.search.type: ${settings.exa.search.type}`,
    `exa.search.numResults: ${settings.exa.search.numResults}`,
    `exa.fetch.maxCharacters: ${settings.exa.fetch.maxCharacters}`,
    `parallel.search.mode: ${settings.parallel.search.mode}`,
    `parallel.search.maxResults: ${settings.parallel.search.maxResults}`,
    `parallel.fetch.maxCharacters: ${settings.parallel.fetch.maxCharacters}`,
    `global: ${globalPiWebConfigPath()}`,
  ].join("\n");
