import type { ExecutionEngine } from "@executor-js/execution";
import type { AnyPlugin, Executor } from "@executor-js/sdk/core";
import { Context, Effect, Layer } from "effect";

import { createExecutorHost } from "../executor/index.ts";
import { ExecutorHostError } from "../errors.ts";
import type { SearchMode } from "../schemas/settings.ts";
import type { SearchIndexStatus } from "../search/store.ts";
import type { SearchDebugRow } from "../search/store.ts";

export interface ExecutorHost<TEngine = ExecutionEngine<any>> {
  readonly executor: Executor<readonly AnyPlugin[]>;
  readonly engine: TEngine;
  readonly plugins: readonly AnyPlugin[];
  readonly scopeDir: string;
  readonly scopeId: string;
  readonly dataDir: string;
  readonly sqlitePath: string;
  readonly searchSqlitePath: string;
  readonly searchDocumentCount: number;
  readonly searchIndexStatus: SearchIndexStatus;
  readonly searchMode: SearchMode;
  readonly configPath: string;
  readonly globalSettingsPath: string;
  readonly projectSettingsPath: string;
  readonly reconcileSearchIndex: () => Effect.Effect<SearchIndexStatus, ExecutorHostError>;
  readonly close: () => Effect.Effect<void>;
  readonly rebuildSearchIndex: () => Effect.Effect<SearchIndexStatus, ExecutorHostError>;
  readonly inspectSearchDocument: (
    path: string,
  ) => Effect.Effect<SearchDebugRow | null, ExecutorHostError>;
  readonly reload: () => Effect.Effect<ExecutorHost, ExecutorHostError>;
}

export class ExecutorHostService extends Context.Service<
  ExecutorHostService,
  {
    readonly get: (cwd: string) => Effect.Effect<ExecutorHost, ExecutorHostError>;
    readonly reload: (cwd: string) => Effect.Effect<ExecutorHost, ExecutorHostError>;
    readonly closeAll: Effect.Effect<void>;
  }
>()("ExecutorHostService") {
  static readonly Default = Layer.effect(this)(
    Effect.sync(() => {
      const hosts = new Map<string, ExecutorHost>();

      const closeHost = (host: ExecutorHost): Effect.Effect<void> => host.close();

      const get = (cwd: string): Effect.Effect<ExecutorHost, ExecutorHostError> =>
        Effect.gen(function* () {
          const existing = hosts.get(cwd);
          if (existing) return existing;

          const host = yield* createExecutorHost({ cwd });
          hosts.set(cwd, host);
          return host;
        });

      const reload = (cwd: string): Effect.Effect<ExecutorHost, ExecutorHostError> =>
        Effect.gen(function* () {
          const existing = hosts.get(cwd);
          if (existing) {
            yield* closeHost(existing);
          }

          const host = yield* createExecutorHost({ cwd });
          hosts.set(cwd, host);
          return host;
        });

      return {
        get,
        reload,
        closeAll: Effect.gen(function* () {
          const current = [...hosts.values()];
          hosts.clear();
          yield* Effect.all(current.map(closeHost), { concurrency: "unbounded", discard: true });
        }),
      };
    }),
  );
}
