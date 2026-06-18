import { ExecutionToolError, type ToolDiscoveryProvider } from "@executor-js/execution";
import { Effect } from "effect";

import type { SearchEmbeddingProvider } from "./embeddings.ts";
import { searchToolDocuments, type SearchStore } from "./store.ts";

export const makeFtsToolDiscoveryProvider = (
  store: SearchStore,
  options?: {
    readonly hybrid?: boolean;
    readonly embeddingProvider?: SearchEmbeddingProvider;
  },
): ToolDiscoveryProvider => ({
  searchTools: ({ query, namespace, limit, offset }) =>
    Effect.gen(function* () {
      const queryVector =
        options?.hybrid && options.embeddingProvider
          ? yield* options.embeddingProvider.embedQuery(query)
          : undefined;
      return yield* Effect.try({
        try: () =>
          searchToolDocuments(store.db, {
            query,
            namespace,
            limit,
            offset,
            mode: options?.hybrid ? "hybrid" : "fts",
            queryVector,
          }),
        catch: (cause) =>
          new ExecutionToolError({
            message: `Executor FTS search failed at ${store.path}.`,
            cause,
          }),
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ExecutionToolError({
            message: `Executor FTS search failed at ${store.path}.`,
            cause,
          }),
      ),
    ),
});
