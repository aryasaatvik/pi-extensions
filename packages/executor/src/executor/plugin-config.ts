import { loadPluginsFromJsonc } from "@executor-js/config";
import type { AnyPlugin } from "@executor-js/sdk/core";
import { fileSecretsPlugin } from "@executor-js/plugin-file-secrets";
import { graphqlPlugin } from "@executor-js/plugin-graphql";
import { keychainPlugin } from "@executor-js/plugin-keychain";
import { mcpPlugin } from "@executor-js/plugin-mcp";
import { openApiPlugin } from "@executor-js/plugin-openapi";
import { Effect } from "effect";
import { join } from "node:path";

import { ExecutorHostError } from "../errors.ts";

const resolvePluginConfigPath = (scopeDir: string): string => join(scopeDir, "executor.jsonc");

const loadStaticPlugins = (): readonly AnyPlugin[] =>
  [
    openApiPlugin(),
    mcpPlugin({ dangerouslyAllowStdioMCP: true }),
    graphqlPlugin(),
    keychainPlugin(),
    fileSecretsPlugin(),
  ] as const;

export interface LoadedExecutorPlugins {
  readonly plugins: readonly AnyPlugin[];
  readonly configPath: string;
}

export const loadExecutorPlugins = (
  scopeDir: string,
): Effect.Effect<LoadedExecutorPlugins, ExecutorHostError> =>
  Effect.tryPromise({
    try: async () => {
      const staticPlugins = loadStaticPlugins();
      const dynamicPlugins =
        (await loadPluginsFromJsonc({ path: resolvePluginConfigPath(scopeDir) })) ?? [];
      const staticPackageNames = new Set(
        staticPlugins
          .map((plugin) => plugin.packageName)
          .filter((name): name is string => typeof name === "string" && name.length > 0),
      );
      const dedupedDynamic = dynamicPlugins.filter((plugin) => {
        if (plugin.packageName && staticPackageNames.has(plugin.packageName)) {
          console.warn(
            `[executor-pi] plugin "${plugin.packageName}" appears in both static config and executor.jsonc#plugins. The static entry wins.`,
          );
          return false;
        }

        return true;
      });

      return {
        plugins: [...staticPlugins, ...dedupedDynamic],
        configPath: resolvePluginConfigPath(scopeDir),
      };
    },
    catch: (cause) =>
      new ExecutorHostError({
        message: `Failed to load Executor plugins for ${scopeDir}`,
        cause,
      }),
  });
