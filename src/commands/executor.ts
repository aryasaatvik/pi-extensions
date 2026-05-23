import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Source } from "@executor-js/sdk/core";
import { Effect, Result } from "effect";

import { formatErrorWithCauses } from "../errors.ts";
import { ConfigService } from "../services/config.ts";
import { ExecutorHostService, type ExecutorHost } from "../services/executor-host.ts";
import { logDebug } from "../services/logger.ts";
import { SessionStateService } from "../services/session-state.ts";

export interface ExecutorStatus {
  readonly summary: string;
  readonly level: "info" | "warning" | "error";
  readonly statusBar: string;
}

const commandHelp = [
  "/executor status - show active Executor host status",
  "/executor reload - rebuild the Executor host for this cwd",
  "/executor settings - show Pi Executor rendering settings",
  "/executor help - show this help",
].join("\n");

const maxStatusSources = 12;

const formatPlugins = (host: ExecutorHost): string => {
  const names = host.plugins
    .map((plugin) => plugin.packageName ?? plugin.id)
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  return names.length > 0 ? names.join(", ") : "(none)";
};

const formatSource = (source: Source): string => {
  const scope = source.scopeId ? ` scope=${source.scopeId}` : "";
  const flags = [
    source.runtime ? "runtime" : "static",
    source.canRefresh ? "refreshable" : undefined,
    source.canEdit ? "editable" : undefined,
    source.canRemove ? "removable" : undefined,
  ]
    .filter((flag): flag is string => flag !== undefined)
    .join(", ");

  return `- ${source.id} (${source.kind}, ${source.pluginId}${scope}; ${flags})`;
};

const formatSources = (sources: readonly Source[]): string => {
  if (sources.length === 0) return "(none)";

  const visible = sources
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .slice(0, maxStatusSources)
    .map(formatSource);
  const hidden = sources.length - visible.length;

  return hidden > 0 ? [...visible, `... ${hidden} more source(s)`].join("\n") : visible.join("\n");
};

const formatHostStatus = (host: ExecutorHost, sources: readonly Source[]): string =>
  [
    `Executor host ready for ${host.scopeDir}`,
    `Scope: ${host.scopeId}`,
    `Config: ${host.configPath}`,
    `Storage: ${host.sqlitePath}`,
    `Plugins: ${formatPlugins(host)}`,
    `Sources: ${sources.length}`,
    formatSources(sources),
  ].join("\n");

export const executorStatusCommand = (
  args: string,
  ctx: ExtensionCommandContext,
): Effect.Effect<
  ExecutorStatus,
  never,
  ConfigService | ExecutorHostService | SessionStateService
> =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const hosts = yield* ExecutorHostService;
    const sessionState = yield* SessionStateService;
    const resolved = yield* config.resolve(ctx.cwd);
    const snapshot = yield* sessionState.snapshot(ctx);
    const command = args.trim().split(/\s+/, 1)[0]?.toLowerCase() || "status";

    yield* logDebug("executor.status", {
      args: command,
      cwd: resolved.cwd,
      hasUI: snapshot.hasUI,
      model: snapshot.model,
    });

    if (command === "help") {
      return {
        summary: commandHelp,
        level: "info",
        statusBar: "executor: help",
      };
    }

    if (command === "settings") {
      return {
        summary: [
          "Pi Executor settings",
          `maxCodePreviewLines: ${resolved.settings.render.maxCodePreviewLines}`,
          `maxJsonBytes: ${resolved.settings.render.maxJsonBytes}`,
          `maxLogLines: ${resolved.settings.render.maxLogLines}`,
        ].join("\n"),
        level: "info",
        statusBar: "executor: settings",
      };
    }

    if (command !== "status" && command !== "reload") {
      return {
        summary: `Unknown /executor command: ${command}\n\n${commandHelp}`,
        level: "warning",
        statusBar: "executor: help",
      };
    }

    const loadHost = command === "reload" ? hosts.reload(resolved.cwd) : hosts.get(resolved.cwd);
    const host = yield* Effect.result(loadHost);

    if (Result.isFailure(host)) {
      return {
        summary: formatErrorWithCauses(host.failure),
        level: "error",
        statusBar: "executor: error",
      };
    }

    const sources = yield* Effect.result(host.success.executor.sources.list());

    if (Result.isFailure(sources)) {
      return {
        summary: `${formatHostStatus(host.success, [])}\n\nFailed to list sources:\n${formatErrorWithCauses(sources.failure)}`,
        level: "warning",
        statusBar:
          command === "reload"
            ? "executor: reloaded, sources error"
            : "executor: ready, sources error",
      };
    }

    return {
      summary: formatHostStatus(host.success, sources.success),
      level: "info",
      statusBar: command === "reload" ? "executor: reloaded" : "executor: ready",
    };
  });
