import {
  createExecutionEngine,
  defaultToolDiscoveryProvider,
  type ExecutionEngine,
  type ToolDiscoveryProvider,
} from "@executor-js/execution/core";
import {
  createExecutor,
  collectTables,
  Scope,
  ScopeId,
  type AnyPlugin,
  type Executor,
} from "@executor-js/sdk/core";
import { makeQuickJsExecutor } from "@executor-js/runtime-quickjs";
import { Effect } from "effect";

import { globalExecutorPiConfigPath, projectExecutorPiConfigPath } from "../config/paths.ts";
import { loadExecutorPiSettings } from "../config/store.ts";
import { ExecutorHostError } from "../errors.ts";
import { makeConfiguredSearchEmbeddingProvider } from "../search/embeddings.ts";
import { rebuildSearchIndex, reconcileSearchIndex } from "../search/indexer.ts";
import { makeFtsToolDiscoveryProvider } from "../search/provider.ts";
import {
  getSearchIndexStatus,
  hasUsableSearchIndex,
  inspectSearchDocument,
  openSearchStore,
} from "../search/store.ts";
import type { ExecutorHost } from "../services/executor-host.ts";
import { loadExecutorPlugins } from "./plugin-config.ts";
import { resolveExecutorScope } from "./scope.ts";
import { createSqliteFumaDb } from "./sqlite-fumadb.ts";
import { resolveExecutorStorage } from "./storage.ts";
import type { SearchMode } from "../schemas/settings.ts";

const localNamespace = "executor_local";

export interface CreateExecutorHostOptions {
  readonly cwd: string;
  readonly searchModeOverride?: SearchMode;
}

export const createExecutorHost = (
  options: CreateExecutorHostOptions,
): Effect.Effect<ExecutorHost, ExecutorHostError> =>
  Effect.gen(function* () {
    const scope = resolveExecutorScope(options.cwd);
    const storage = resolveExecutorStorage();
    const loadedSettings = yield* loadExecutorPiSettings(scope.scopeDir);
    const settings = options.searchModeOverride
      ? {
          ...loadedSettings,
          search: { ...loadedSettings.search, mode: options.searchModeOverride },
        }
      : loadedSettings;
    const embeddingProvider = makeConfiguredSearchEmbeddingProvider(settings.search.embeddings);
    const loaded = yield* loadExecutorPlugins(scope.scopeDir);
    const sqlite = yield* Effect.tryPromise({
      try: () =>
        createSqliteFumaDb({
          tables: collectTables(loaded.plugins) as never,
          namespace: localNamespace,
          path: storage.sqlitePath,
        }),
      catch: (cause) =>
        new ExecutorHostError({
          message: `Failed to open Executor local storage at ${storage.sqlitePath}`,
          cause,
        }),
    });
    const executorScope = Scope.make({
      id: ScopeId.make(scope.scopeId),
      name: scope.scopeDir,
      createdAt: new Date(),
    });

    const executor = yield* createExecutor({
      scopes: [executorScope],
      db: {
        db: sqlite.db as never,
        close: sqlite.close,
      },
      plugins: loaded.plugins,
      onElicitation: "accept-all",
      oauthEndpointUrlPolicy: { allowHttp: true },
      coreTools: {
        webBaseUrl:
          process.env.EXECUTOR_WEB_BASE_URL ?? `http://localhost:${process.env.PORT ?? "4788"}`,
      },
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ExecutorHostError({
            message: `Failed to create Executor host for ${scope.scopeDir}`,
            cause,
          }),
      ),
    );

    const searchStore = yield* Effect.try({
      try: () =>
        openSearchStore(storage.searchSqlitePath, {
          embeddingDimensions: embeddingProvider?.dimensions,
        }),
      catch: (cause) =>
        new ExecutorHostError({
          message: `Failed to open Executor Pi search storage at ${storage.searchSqlitePath}`,
          cause,
        }),
    });
    const mapSearchError = (cause: unknown) =>
      new ExecutorHostError({
        message: cause instanceof Error ? cause.message : "Executor search index failed.",
        cause,
      });
    let searchIndexStatus = getSearchIndexStatus(searchStore.db);
    if (
      settings.search.mode !== "executor" &&
      !hasUsableSearchIndex(searchStore.db, embeddingProvider)
    ) {
      yield* rebuildSearchIndex(searchStore, executor, embeddingProvider).pipe(
        Effect.mapError(
          (cause) =>
            new ExecutorHostError({
              message: cause.message,
              cause,
            }),
        ),
      );
      searchIndexStatus = getSearchIndexStatus(searchStore.db);
    }
    let searchDocumentCount = searchIndexStatus.documentCount;
    const toolDiscoveryProvider: ToolDiscoveryProvider =
      settings.search.mode === "executor"
        ? defaultToolDiscoveryProvider
        : makeFtsToolDiscoveryProvider(searchStore, {
            hybrid: settings.search.mode === "hybrid" && embeddingProvider !== null,
            embeddingProvider: embeddingProvider ?? undefined,
          });
    const engine = createExecutionEngine({
      executor,
      codeExecutor: makeQuickJsExecutor(),
      toolDiscoveryProvider,
    });

    return {
      executor: executor as Executor<readonly AnyPlugin[]>,
      engine,
      plugins: loaded.plugins,
      scopeDir: scope.scopeDir,
      scopeId: scope.scopeId,
      dataDir: storage.dataDir,
      sqlitePath: storage.sqlitePath,
      searchSqlitePath: storage.searchSqlitePath,
      get searchDocumentCount() {
        return searchDocumentCount;
      },
      get searchIndexStatus() {
        return searchIndexStatus;
      },
      searchMode: settings.search.mode,
      configPath: loaded.configPath,
      globalSettingsPath: globalExecutorPiConfigPath(),
      projectSettingsPath: projectExecutorPiConfigPath(scope.scopeDir),
      close: () =>
        executor
          .close()
          .pipe(Effect.ensuring(Effect.sync(() => searchStore.close())), Effect.ignore),
      reconcileSearchIndex: () =>
        reconcileSearchIndex(searchStore, executor, embeddingProvider).pipe(
          Effect.mapError(mapSearchError),
          Effect.map((documents) => {
            searchDocumentCount = documents.length;
            searchIndexStatus = getSearchIndexStatus(searchStore.db);
            return searchIndexStatus;
          }),
        ),
      rebuildSearchIndex: () =>
        rebuildSearchIndex(searchStore, executor, embeddingProvider).pipe(
          Effect.mapError(mapSearchError),
          Effect.map((documents) => {
            searchDocumentCount = documents.length;
            searchIndexStatus = getSearchIndexStatus(searchStore.db);
            return searchIndexStatus;
          }),
        ),
      inspectSearchDocument: (path) =>
        Effect.try({
          try: () => inspectSearchDocument(searchStore.db, path),
          catch: mapSearchError,
        }),
      reload: () => createExecutorHost(options),
    } satisfies ExecutorHost<ExecutionEngine<any>>;
  });
