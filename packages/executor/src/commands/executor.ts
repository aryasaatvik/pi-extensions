import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Source } from "@executor-js/sdk/core";
import { Effect, Match, Result } from "effect";

import { runExecutorConfigUi } from "./executor-config.ts";
import { executorCommandHelp, parseExecutorSubcommand } from "./executor-subcommand.ts";
import { formatErrorWithCauses } from "../errors.ts";
import { ConfigService } from "../services/config.ts";
import { ExecutorHostService, type ExecutorHost } from "../services/executor-host.ts";
import { SessionStateService } from "../services/session-state.ts";
import { probeSearchRuntimeStatus, type SearchRuntimeStatus } from "../search/runtime.ts";
import type { SearchDebugRow } from "../search/store.ts";

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

const formatCapability = (label: string, capability: SearchRuntimeStatus["fts5"]): string =>
  `${label}: ${capability.available ? "available" : "unavailable"} (${capability.detail})`;

const formatSearchStatus = (status: SearchRuntimeStatus): string =>
  [
    `Search DB: ${status.searchSqlitePath}`,
    formatCapability("SQLite FTS5", status.fts5),
    formatCapability("sqlite-vec", status.sqliteVec),
  ].join("\n");

const formatHostStatus = (
  host: ExecutorHost,
  sources: readonly Source[],
  searchStatus: SearchRuntimeStatus,
): string =>
  [
    `Executor host ready for ${host.scopeDir}`,
    `Scope: ${host.scopeId}`,
    `Search mode: ${host.searchMode}`,
    `Executor config: ${host.configPath}`,
    `Pi settings: ${host.globalSettingsPath}`,
    `Project Pi settings: ${host.projectSettingsPath}`,
    `Storage: ${host.sqlitePath}`,
    formatSearchStatus(searchStatus),
    `Indexed tools: ${host.searchDocumentCount}`,
    `Index status: ${host.searchIndexStatus.status}`,
    `Indexed embeddings: ${host.searchIndexStatus.embeddingCount}`,
    `Indexed sources: ${host.searchIndexStatus.sourceCount}`,
    `Last index run: ${host.searchIndexStatus.completedAt ?? host.searchIndexStatus.startedAt ?? "never"}`,
    ...(host.searchIndexStatus.error ? [`Index error: ${host.searchIndexStatus.error}`] : []),
    `Plugins: ${formatPlugins(host)}`,
    `Sources: ${sources.length}`,
    formatSources(sources),
  ].join("\n");

const formatSearchIndexStatus = (host: ExecutorHost, searchStatus: SearchRuntimeStatus): string =>
  [
    `Search index for ${host.scopeDir}`,
    `Search mode: ${host.searchMode}`,
    `Pi settings: ${host.globalSettingsPath}`,
    `Project Pi settings: ${host.projectSettingsPath}`,
    formatSearchStatus(searchStatus),
    `Status: ${host.searchIndexStatus.status}`,
    `Tools: ${host.searchIndexStatus.documentCount}`,
    `Embeddings: ${host.searchIndexStatus.embeddingCount}`,
    `Sources: ${host.searchIndexStatus.sourceCount}`,
    `Started: ${host.searchIndexStatus.startedAt ?? "never"}`,
    `Completed: ${host.searchIndexStatus.completedAt ?? "never"}`,
    ...(host.searchIndexStatus.error ? [`Error: ${host.searchIndexStatus.error}`] : []),
  ].join("\n");

const formatSearchInspect = (row: SearchDebugRow): string =>
  [
    `Tool: ${row.path}`,
    `Source: ${row.sourceId}`,
    `Name: ${row.name}`,
    `Description: ${row.description}`,
    `Updated: ${row.updatedAt}`,
    `Embedding: ${
      row.embeddingModel
        ? `${row.embeddingModel} (${row.embeddingDimensions ?? "unknown"} dimensions, ${row.embeddingUpdatedAt ?? "unknown"})`
        : "not indexed"
    }`,
    "",
    "Search text",
    row.searchText,
    "",
    "Embedding text",
    row.embeddingText,
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
    const searchStatus = yield* Effect.sync(() => probeSearchRuntimeStatus());

    if (Result.isFailure(sources)) {
      return {
        summary: `${formatHostStatus(host.success, [], searchStatus)}\n\nFailed to list sources:\n${formatErrorWithCauses(sources.failure)}`,
        level: "warning",
        statusBar: reload ? "executor: reloaded, sources error" : "executor: ready, sources error",
      };
    }

    return {
      summary: formatHostStatus(host.success, sources.success, searchStatus),
      level: "info",
      statusBar: reload ? "executor: reloaded" : "executor: ready",
    };
  });

const getHostForCommand = (
  cwd: string,
): Effect.Effect<ExecutorHost, ExecutorStatus, ExecutorHostService> =>
  Effect.gen(function* () {
    const hosts = yield* ExecutorHostService;
    const host = yield* Effect.result(hosts.get(cwd));
    if (Result.isFailure(host)) {
      return yield* Effect.fail({
        summary: formatErrorWithCauses(host.failure),
        level: "error",
        statusBar: "executor: error",
      } satisfies ExecutorStatus);
    }
    return host.success;
  });

const runSearchStatusSubcommand = (
  cwd: string,
): Effect.Effect<ExecutorStatus, never, ExecutorHostService> =>
  getHostForCommand(cwd).pipe(
    Effect.flatMap((host) =>
      Effect.sync(() => probeSearchRuntimeStatus()).pipe(
        Effect.map(
          (searchStatus) =>
            ({
              summary: formatSearchIndexStatus(host, searchStatus),
              level: host.searchIndexStatus.status === "failed" ? "warning" : "info",
              statusBar: `executor search: ${host.searchIndexStatus.status}`,
            }) satisfies ExecutorStatus,
        ),
      ),
    ),
    Effect.catch(Effect.succeed),
  );

const runSearchRebuildSubcommand = (
  cwd: string,
): Effect.Effect<ExecutorStatus, never, ExecutorHostService> =>
  getHostForCommand(cwd).pipe(
    Effect.flatMap((host) =>
      host.rebuildSearchIndex().pipe(
        Effect.map(
          (status) =>
            ({
              summary: [
                "Search index rebuilt",
                `Tools: ${status.documentCount}`,
                `Embeddings: ${status.embeddingCount}`,
                `Sources: ${status.sourceCount}`,
                `Completed: ${status.completedAt ?? "unknown"}`,
              ].join("\n"),
              level: "info",
              statusBar: "executor search: rebuilt",
            }) satisfies ExecutorStatus,
        ),
        Effect.catch((error) =>
          Effect.succeed({
            summary: formatErrorWithCauses(error),
            level: "error",
            statusBar: "executor search: error",
          } satisfies ExecutorStatus),
        ),
      ),
    ),
    Effect.catch(Effect.succeed),
  );

const runSearchReconcileSubcommand = (
  cwd: string,
): Effect.Effect<ExecutorStatus, never, ExecutorHostService> =>
  getHostForCommand(cwd).pipe(
    Effect.flatMap((host) =>
      host.reconcileSearchIndex().pipe(
        Effect.map(
          (status) =>
            ({
              summary: [
                "Search index reconciled",
                `Tools: ${status.documentCount}`,
                `Embeddings: ${status.embeddingCount}`,
                `Sources: ${status.sourceCount}`,
                `Completed: ${status.completedAt ?? "unknown"}`,
              ].join("\n"),
              level: "info",
              statusBar: "executor search: reconciled",
            }) satisfies ExecutorStatus,
        ),
        Effect.catch((error) =>
          Effect.succeed({
            summary: formatErrorWithCauses(error),
            level: "error",
            statusBar: "executor search: error",
          } satisfies ExecutorStatus),
        ),
      ),
    ),
    Effect.catch(Effect.succeed),
  );

const runSearchInspectSubcommand = (
  cwd: string,
  path: string,
): Effect.Effect<ExecutorStatus, never, ExecutorHostService> =>
  getHostForCommand(cwd).pipe(
    Effect.flatMap((host) =>
      host.inspectSearchDocument(path).pipe(
        Effect.map(
          (row) =>
            ({
              summary: row ? formatSearchInspect(row) : `Tool not found in search index: ${path}`,
              level: row ? "info" : "warning",
              statusBar: row ? "executor search: inspected" : "executor search: not found",
            }) satisfies ExecutorStatus,
        ),
        Effect.catch((error) =>
          Effect.succeed({
            summary: formatErrorWithCauses(error),
            level: "error",
            statusBar: "executor search: error",
          } satisfies ExecutorStatus),
        ),
      ),
    ),
    Effect.catch(Effect.succeed),
  );

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
      Match.tag("SearchStatus", () => runSearchStatusSubcommand(resolved.cwd)),
      Match.tag("SearchReconcile", () => runSearchReconcileSubcommand(resolved.cwd)),
      Match.tag("SearchRebuild", () => runSearchRebuildSubcommand(resolved.cwd)),
      Match.tag("SearchInspect", ({ path }) => runSearchInspectSubcommand(resolved.cwd, path)),
      Match.tag("Unknown", ({ name }) => Effect.succeed(unknownStatus(name))),
      Match.exhaustive,
    );
  });
