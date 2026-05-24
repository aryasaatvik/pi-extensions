import { createExecutionEngine, type ExecutionEngine } from "@executor-js/execution/core";
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

import { ExecutorHostError } from "../errors.ts";
import type { ExecutorHost } from "../services/executor-host.ts";
import { loadExecutorPlugins } from "./plugin-config.ts";
import { resolveExecutorScope } from "./scope.ts";
import { createSqliteFumaDb } from "./sqlite-fumadb.ts";
import { resolveExecutorStorage } from "./storage.ts";

const localNamespace = "executor_local";

export interface CreateExecutorHostOptions {
  readonly cwd: string;
}

export const createExecutorHost = (
  options: CreateExecutorHostOptions,
): Effect.Effect<ExecutorHost, ExecutorHostError> =>
  Effect.gen(function* () {
    const scope = resolveExecutorScope(options.cwd);
    const storage = resolveExecutorStorage();
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

    const engine = createExecutionEngine({
      executor,
      codeExecutor: makeQuickJsExecutor(),
    });

    return {
      executor: executor as Executor<readonly AnyPlugin[]>,
      engine,
      plugins: loaded.plugins,
      scopeDir: scope.scopeDir,
      scopeId: scope.scopeId,
      dataDir: storage.dataDir,
      sqlitePath: storage.sqlitePath,
      configPath: loaded.configPath,
      close: () => executor.close().pipe(Effect.ignore),
      reload: () => createExecutorHost(options),
    } satisfies ExecutorHost<ExecutionEngine<any>>;
  });
