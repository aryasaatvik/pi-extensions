import { createHash } from "node:crypto";

import { Effect } from "effect";

import type { SearchEmbeddingProvider } from "./embeddings.ts";

export const TestSearchEmbeddingDimensions = 64;

const tokenize = (text: string): string[] =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

const normalize = (vector: number[]): readonly number[] => {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
};

const embedText = (text: string, dimensions: number): readonly number[] => {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const token of tokenize(text)) {
    const hash = createHash("sha256").update(token).digest();
    const index = (hash[0] ?? 0) % dimensions;
    const sign = (hash[1] ?? 0) % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.log1p(token.length));
  }
  return normalize(vector);
};

export const makeTestSearchEmbeddingProvider = (
  dimensions = TestSearchEmbeddingDimensions,
): SearchEmbeddingProvider => ({
  provider: "test-hash",
  model: `test-hash-v1-${dimensions}`,
  cacheKey: `test-hash:${dimensions}`,
  dimensions,
  embedDocuments: (texts) => Effect.sync(() => texts.map((text) => embedText(text, dimensions))),
  embedQuery: (text) => Effect.sync(() => embedText(text, dimensions)),
});
