import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Source } from "@executor-js/sdk/core";
import { Effect, Match, Result } from "effect";

import { runExecutorConfigUi } from "./executor-config.ts";
import { executorCommandHelp, parseExecutorSubcommand } from "./executor-subcommand.ts";
import { formatErrorWithCauses } from "../errors.ts";
import { ConfigService } from "../services/config.ts";
import { ExecutorHostService, type ExecutorHost } from "../services/executor-host.ts";
import { SessionStateService } from "../services/session-state.ts";

export interface ExecutorStatus {
  readonly summary: string;
  readonly level: "info" | "warning" | "error";
  readonly statusBar: string;
}

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

const helpStatus = (): ExecutorStatus => ({
  summary: executorCommandHelp,
  level: "info",
  statusBar: "executor: help",
});

const unknownStatus = (name: string): ExecutorStatus => ({
  summary: `Unknown /executor command: ${name}\n\n${executorCommandHelp}`,
  level: "warning",
  statusBar: "executor: help",
});

const runHostSubcommand = (
  reload: boolean,
  cwd: string,
): Effect.Effect<ExecutorStatus, never, ExecutorHostService> =>
  Effect.gen(function* () {
    const hosts = yield* ExecutorHostService;
    const host = yield* Effect.result(reload ? hosts.reload(cwd) : hosts.get(cwd));

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
        statusBar: reload ? "executor: reloaded, sources error" : "executor: ready, sources error",
      };
    }

    return {
      summary: formatHostStatus(host.success, sources.success),
      level: "info",
      statusBar: reload ? "executor: reloaded" : "executor: ready",
    };
  });

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
    const sessionState = yield* SessionStateService;
    const resolved = yield* config.resolve(ctx.cwd);
    const snapshot = yield* sessionState.snapshot(ctx);
    const subcommand = parseExecutorSubcommand(args);

    yield* Effect.logDebug("executor.command").pipe(
      Effect.annotateLogs({
        subcommand: subcommand._tag,
        cwd: resolved.cwd,
        hasUI: snapshot.hasUI,
        model: snapshot.model,
      }),
    );

    return yield* Match.value(subcommand).pipe(
      Match.tag("Help", () => Effect.succeed(helpStatus())),
      Match.tag("Config", () =>
        Effect.gen(function* () {
          yield* runExecutorConfigUi(ctx);
          const refreshed = yield* config.resolve(ctx.cwd);
          return {
            summary: `Executor Pi settings (${refreshed.settings.displayMode})`,
            level: "info",
            statusBar: config.formatStatusBar(refreshed.settings),
          } satisfies ExecutorStatus;
        }),
      ),
      Match.tag("Status", () => runHostSubcommand(false, resolved.cwd)),
      Match.tag("Reload", () => runHostSubcommand(true, resolved.cwd)),
      Match.tag("Unknown", ({ name }) => Effect.succeed(unknownStatus(name))),
      Match.exhaustive,
    );
  });
