import { createHash } from "node:crypto";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { embed, embedMany } from "ai";
import { Effect } from "effect";

import { ExecutionError } from "../errors.ts";
import type { SearchSettings } from "../schemas/settings.ts";

export interface SearchEmbeddingProvider {
  readonly provider: "openai-compatible" | "gemini" | "test-hash";
  readonly model: string;
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

const chunks = <A>(items: readonly A[], size: number): readonly (readonly A[])[] => {
  const safeSize = Math.max(1, Math.floor(size));
  const result: A[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    result.push(items.slice(index, index + safeSize));
  }
  return result;
};

export const searchEmbeddingTextHash = (
  text: string,
  model: string,
  provider: SearchEmbeddingProvider["provider"],
): string => createHash("sha256").update(JSON.stringify({ provider, model, text })).digest("hex");

export const vectorToSql = (vector: readonly number[]): string => JSON.stringify(vector);

export const hasMeaningfulEmbedding = (vector: readonly number[]): boolean =>
  vector.some((value) => value !== 0);

const validateVector = (
  vector: readonly number[],
  dimensions: number,
  label: string,
): readonly number[] => {
  if (vector.length !== dimensions) {
    throw new Error(`${label} returned ${vector.length} dimensions, expected ${dimensions}.`);
  }
  return vector;
};

interface OpenAiCompatibleEmbeddingsResponse {
  readonly data?: readonly {
    readonly embedding?: readonly number[];
  }[];
}

const makeOpenAiCompatibleEmbeddingProvider = (
  config: Extract<
    NonNullable<SearchSettings["embeddings"]>,
    { readonly provider: "openai-compatible" }
  >,
): SearchEmbeddingProvider => {
  const batchSize = config.batchSize ?? defaultBatchSize;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/embeddings`;

  const embedBatch = (texts: readonly string[], apiKey: string | undefined) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            input: [...texts],
          }),
        });
        if (!response.ok) {
          throw new Error(`Embedding request failed with HTTP ${response.status}`);
        }

        const json = (await response.json()) as OpenAiCompatibleEmbeddingsResponse;
        const embeddings = json.data?.map((item, index) =>
          validateVector(item.embedding ?? [], config.dimensions, `Embedding ${index}`),
        );
        if (!embeddings || embeddings.length !== texts.length) {
          throw new Error(
            `Embedding response returned ${embeddings?.length ?? 0} vectors for ${texts.length} inputs.`,
          );
        }
        return embeddings;
      },
      catch: (cause) =>
        new ExecutionError({
          message: `OpenAI-compatible embedding request failed for ${config.model}.`,
          cause,
        }),
    });

  return {
    provider: "openai-compatible",
    model: config.model,
    dimensions: config.dimensions,
    embedDocuments: (texts) =>
      loadAuthApiKey(config.authProvider, { required: false }).pipe(
        Effect.flatMap((apiKey) =>
          Effect.all(
            chunks(texts, batchSize).map((chunk) => embedBatch(chunk, apiKey)),
            {
              concurrency: 1,
            },
          ),
        ),
        Effect.map((groups) => groups.flat()),
      ),
    embedQuery: (text) =>
      loadAuthApiKey(config.authProvider, { required: false }).pipe(
        Effect.flatMap((apiKey) => embedBatch([text], apiKey)),
        Effect.map((vectors) => vectors[0] ?? []),
      ),
  };
};

const makeGeminiEmbeddingProvider = (
  config: Extract<NonNullable<SearchSettings["embeddings"]>, { readonly provider: "gemini" }>,
): SearchEmbeddingProvider => {
  const batchSize = config.batchSize ?? defaultBatchSize;
  const authProvider = config.authProvider ?? "google";

  const embedTexts = (
    texts: readonly string[],
    taskType: typeof documentTaskType | typeof queryTaskType,
    apiKey: string,
  ) =>
    Effect.tryPromise({
      try: async () => {
        if (texts.length === 0) return [];
        const model = createGoogleGenerativeAI({ apiKey }).textEmbedding(config.model);
        if (texts.length === 1) {
          const { embedding } = await embed({
            model,
            value: texts[0]!,
            providerOptions: {
              google: {
                outputDimensionality: config.dimensions,
                taskType,
              },
            },
          });
          return [validateVector(embedding, config.dimensions, "Gemini embedding")];
        }

        const { embeddings } = await embedMany({
          model,
          values: [...texts],
          maxParallelCalls: 5,
          providerOptions: {
            google: {
              outputDimensionality: config.dimensions,
              taskType,
            },
          },
        });
        return embeddings.map((embedding, index) =>
          validateVector(embedding, config.dimensions, `Gemini embedding ${index}`),
        );
      },
      catch: (cause) =>
        new ExecutionError({
          message: `Gemini embedding request failed for ${config.model}.`,
          cause,
        }),
    });

  return {
    provider: "gemini",
    model: config.model,
    dimensions: config.dimensions,
    embedDocuments: (texts) =>
      requireAuthApiKey(authProvider).pipe(
        Effect.flatMap((apiKey) =>
          Effect.all(
            chunks(texts, batchSize).map((chunk) => embedTexts(chunk, documentTaskType, apiKey)),
            {
              concurrency: 1,
            },
          ),
        ),
        Effect.map((groups) => groups.flat()),
      ),
    embedQuery: (text) =>
      requireAuthApiKey(authProvider).pipe(
        Effect.flatMap((apiKey) => embedTexts([text], queryTaskType, apiKey)),
        Effect.map((vectors) => vectors[0] ?? []),
      ),
  };
};

export const makeConfiguredSearchEmbeddingProvider = (
  config: SearchSettings["embeddings"],
): SearchEmbeddingProvider | null => {
  if (!config) return null;
  if (config.provider === "gemini") return makeGeminiEmbeddingProvider(config);
  return makeOpenAiCompatibleEmbeddingProvider(config);
};
