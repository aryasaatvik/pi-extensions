import { describeTool } from "@executor-js/execution";
import { type Executor } from "@executor-js/sdk/core";
import { Effect } from "effect";

import { ExecutionError } from "../errors.ts";
import { projectToolSearchDocument, type ToolSearchDocument } from "./documents.ts";
import { hasMeaningfulEmbedding, type SearchEmbeddingProvider } from "./embeddings.ts";
import {
  completeSearchIndexRun,
  failSearchIndexRun,
  getStaleEmbeddingDocuments,
  reconcileToolDocuments,
  replaceToolDocuments,
  startSearchIndexRun,
  upsertSearchEmbeddings,
  type SearchStore,
} from "./store.ts";

export const collectToolSearchDocuments = (
  executor: Executor,
): Effect.Effect<readonly ToolSearchDocument[], ExecutionError> =>
  Effect.gen(function* () {
    const integrations = yield* executor.integrations.list().pipe(
      Effect.mapError(
        (cause) =>
          new ExecutionError({
            message: "Failed to list Executor integrations for search indexing.",
            cause,
          }),
      ),
    );
    const integrationBySlug = new Map(
      integrations.map((integration) => [String(integration.slug), integration]),
    );
    const tools = yield* executor.tools.list({ includeAnnotations: false }).pipe(
      Effect.mapError(
        (cause) =>
          new ExecutionError({
            message: "Failed to list Executor tools for search indexing.",
            cause,
          }),
      ),
    );

    return yield* Effect.all(
      tools.map((tool) =>
        describeTool(executor, String(tool.address)).pipe(
          Effect.map((schema) =>
            projectToolSearchDocument(tool, {
              schema,
              integration: integrationBySlug.get(String(tool.integration)),
            }),
          ),
          Effect.mapError(
            (cause) =>
              new ExecutionError({
                message: `Failed to describe Executor tool ${String(tool.address)} for search indexing.`,
                cause,
              }),
          ),
        ),
      ),
      { concurrency: 4 },
    );
  });

const indexEmbeddings = (
  store: SearchStore,
  embeddingProvider: SearchEmbeddingProvider,
  documents: readonly Pick<ToolSearchDocument, "path" | "embeddingText">[],
): Effect.Effect<void, ExecutionError> =>
  Effect.gen(function* () {
    if (documents.length === 0) {
      return;
    }

    const vectors = yield* embeddingProvider.embedDocuments(
      documents.map((document) => document.embeddingText),
    );
    const indexedDocuments = documents.filter((_, index) =>
      hasMeaningfulEmbedding(vectors[index] ?? []),
    );
    const indexedVectors = vectors.filter(hasMeaningfulEmbedding);
    yield* Effect.try({
      try: () => {
        upsertSearchEmbeddings(store.db, {
          provider: embeddingProvider.provider,
          cacheKey: embeddingProvider.cacheKey,
          model: embeddingProvider.model,
          dimensions: embeddingProvider.dimensions,
          documents: indexedDocuments,
          vectors: indexedVectors,
        });
      },
      catch: (cause) =>
        new ExecutionError({
          message: `Failed to write Executor search embeddings at ${store.path}.`,
          cause,
        }),
    });
  });

export const rebuildSearchIndex = (
  store: SearchStore,
  executor: Executor,
  embeddingProvider: SearchEmbeddingProvider | null,
): Effect.Effect<readonly ToolSearchDocument[], ExecutionError> =>
  Effect.gen(function* () {
    const runId = yield* Effect.sync(() => startSearchIndexRun(store.db));
    return yield* collectToolSearchDocuments(executor).pipe(
      Effect.flatMap((documents) =>
        Effect.gen(function* () {
          yield* Effect.try({
            try: () => {
              replaceToolDocuments(store.db, documents);
            },
            catch: (cause) =>
              new ExecutionError({
                message: `Failed to write Executor search index at ${store.path}.`,
                cause,
              }),
          });
          if (!embeddingProvider) {
            completeSearchIndexRun(store.db, runId);
            return documents;
          }
          yield* indexEmbeddings(store, embeddingProvider, documents);
          completeSearchIndexRun(store.db, runId);
          return documents;
        }),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => failSearchIndexRun(store.db, runId, error.message)),
      ),
    );
  });

export const reconcileSearchIndex = (
  store: SearchStore,
  executor: Executor,
  embeddingProvider: SearchEmbeddingProvider | null,
): Effect.Effect<readonly ToolSearchDocument[], ExecutionError> =>
  Effect.gen(function* () {
    const runId = yield* Effect.sync(() => startSearchIndexRun(store.db));
    return yield* collectToolSearchDocuments(executor).pipe(
      Effect.flatMap((documents) =>
        Effect.gen(function* () {
          yield* Effect.try({
            try: () => {
              reconcileToolDocuments(store.db, documents);
            },
            catch: (cause) =>
              new ExecutionError({
                message: `Failed to reconcile Executor search index at ${store.path}.`,
                cause,
              }),
          });
          if (embeddingProvider) {
            const staleDocuments = yield* Effect.try({
              try: () => getStaleEmbeddingDocuments(store.db, documents, embeddingProvider),
              catch: (cause) =>
                new ExecutionError({
                  message: `Failed to inspect Executor search embeddings at ${store.path}.`,
                  cause,
                }),
            });
            yield* indexEmbeddings(store, embeddingProvider, staleDocuments);
          }
          completeSearchIndexRun(store.db, runId);
          return documents;
        }),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => failSearchIndexRun(store.db, runId, error.message)),
      ),
    );
  });
