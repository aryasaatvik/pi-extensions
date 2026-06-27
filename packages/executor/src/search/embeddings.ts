import { createHash } from "node:crypto";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { makeEmbedder, type ToolEmbedder } from "@executor-js/plugin-semantic-search";
import { Effect } from "effect";

import { ExecutionError } from "../errors.ts";
import type { SearchSettings } from "../schemas/settings.ts";

export interface SearchEmbeddingProvider {
  readonly provider: "openai-compatible" | "gemini" | "test-hash";
  readonly model: string;
  readonly cacheKey: string;
  readonly dimensions: number;
  readonly embedDocuments: (
    texts: readonly string[],
  ) => Effect.Effect<readonly (readonly number[])[], ExecutionError>;
  readonly embedQuery: (text: string) => Effect.Effect<readonly number[], ExecutionError>;
}

const defaultBatchSize = 32;
const documentTaskType = "RETRIEVAL_DOCUMENT";
const queryTaskType = "RETRIEVAL_QUERY";

const loadAuthApiKey = (
  provider: string | undefined,
  options: { readonly required: boolean },
): Effect.Effect<string | undefined, ExecutionError> => {
  if (!provider) return Effect.succeed(undefined);
  return Effect.tryPromise({
    try: async () => {
      const key = await AuthStorage.create().getApiKey(provider);
      const trimmed = key?.trim();
      if (trimmed) return trimmed;
      if (options.required) {
        throw new Error(
          `Embedding API key is not stored in ~/.pi/agent/auth.json under "${provider}".`,
        );
      }
      return undefined;
    },
    catch: (cause) =>
      new ExecutionError({
        message: `Failed to load embedding API key for auth provider "${provider}".`,
        cause,
      }),
  });
};

const requireAuthApiKey = (provider: string): Effect.Effect<string, ExecutionError> =>
  loadAuthApiKey(provider, { required: true }).pipe(
    Effect.flatMap((key) =>
      key
        ? Effect.succeed(key)
        : Effect.fail(new ExecutionError({ message: `Missing API key for ${provider}.` })),
    ),
  );

export const searchEmbeddingTextHash = (text: string, model: string, cacheKey: string): string =>
  createHash("sha256").update(JSON.stringify({ cacheKey, model, text })).digest("hex");

export const vectorToSql = (vector: readonly number[]): string => JSON.stringify(vector);

export const hasMeaningfulEmbedding = (vector: readonly number[]): boolean =>
  vector.some((value) => value !== 0);

const mapEmbeddingError = (cause: unknown): ExecutionError =>
  new ExecutionError({
    message: cause instanceof Error ? cause.message : "Executor search embedding failed.",
    cause,
  });

const makeSearchEmbeddingProvider = (input: {
  readonly provider: SearchEmbeddingProvider["provider"];
  readonly cacheKey: string;
  readonly embedder: ToolEmbedder;
}): SearchEmbeddingProvider => ({
  provider: input.provider,
  model: input.embedder.model,
  cacheKey: input.cacheKey,
  dimensions: input.embedder.dimensions,
  embedDocuments: (texts) =>
    input.embedder.embedDocuments(texts).pipe(Effect.mapError(mapEmbeddingError)),
  embedQuery: (text) => input.embedder.embedQuery(text).pipe(Effect.mapError(mapEmbeddingError)),
});

const makeOpenAiCompatibleEmbeddingProvider = (
  config: Extract<
    NonNullable<SearchSettings["embeddings"]>,
    { readonly provider: "openai-compatible" }
  >,
): Effect.Effect<SearchEmbeddingProvider, ExecutionError> =>
  loadAuthApiKey(config.authProvider, { required: false }).pipe(
    Effect.map((apiKey) => {
      const baseUrl = config.baseUrl.replace(/\/+$/, "");
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: baseUrl,
        apiKey,
      });
      return makeSearchEmbeddingProvider({
        provider: "openai-compatible",
        cacheKey: `openai-compatible:${baseUrl}:${config.model}`,
        embedder: makeEmbedder({
          model: provider.textEmbeddingModel(config.model),
          modelId: config.model,
          dimensions: config.dimensions,
          batchSize: config.batchSize ?? defaultBatchSize,
          documentProviderOptions: { "openai-compatible": { dimensions: config.dimensions } },
          queryProviderOptions: { "openai-compatible": { dimensions: config.dimensions } },
        }),
      });
    }),
  );

const makeGeminiEmbeddingProvider = (
  config: Extract<NonNullable<SearchSettings["embeddings"]>, { readonly provider: "gemini" }>,
): Effect.Effect<SearchEmbeddingProvider, ExecutionError> => {
  const authProvider = config.authProvider ?? "google";

  return requireAuthApiKey(authProvider).pipe(
    Effect.map((apiKey) => {
      const provider = createGoogleGenerativeAI({ apiKey });
      return makeSearchEmbeddingProvider({
        provider: "gemini",
        cacheKey: `gemini:${config.model}`,
        embedder: makeEmbedder({
          model: provider.textEmbedding(config.model),
          modelId: config.model,
          dimensions: config.dimensions,
          batchSize: config.batchSize ?? defaultBatchSize,
          maxParallelCalls: 5,
          documentProviderOptions: {
            google: {
              outputDimensionality: config.dimensions,
              taskType: documentTaskType,
            },
          },
          queryProviderOptions: {
            google: {
              outputDimensionality: config.dimensions,
              taskType: queryTaskType,
            },
          },
        }),
      });
    }),
  );
};

export const makeConfiguredSearchEmbeddingProvider = (
  config: SearchSettings["embeddings"],
): Effect.Effect<SearchEmbeddingProvider | null, ExecutionError> => {
  if (!config) return Effect.succeed(null);
  if (config.provider === "gemini") return makeGeminiEmbeddingProvider(config);
  return makeOpenAiCompatibleEmbeddingProvider(config);
};
