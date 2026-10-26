import { Effect } from "effect";

import { parseCategoryFromQuery } from "../../domain/category.ts";
import { WebSearchError } from "../../domain/errors.ts";
import type {
  WebSearchFilters,
  WebSearchHit,
  WebSearchInput,
  WebSearchOutput,
} from "../../domain/types.ts";
import type { WebConfig } from "../../services/config.ts";
import type { Exa } from "exa-js";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * exa-js 2.26 accepts `publication` where this extension still says
 * `research paper`. The SDK no longer has a `pdf` category, so that filter
 * is dropped instead of sending a value the client rejects.
 */
export const toExaCategory = (
  category: NonNullable<WebSearchFilters["category"]> | undefined,
): "company" | "publication" | "news" | "personal site" | "people" | undefined => {
  switch (category) {
    case "research paper":
      return "publication";
    case undefined:
    case "pdf":
      return undefined;
    case "company":
    case "news":
    case "personal site":
    case "people":
      return category;
  }
};

const mapHit = (result: {
  title?: string | null;
  url?: string | null;
  publishedDate?: string | null;
  author?: string | null;
  highlights?: string[] | null;
  text?: string | null;
}): WebSearchHit | null => {
  if (!result.url) return null;
  const highlights =
    Array.isArray(result.highlights) && result.highlights.length > 0
      ? result.highlights
      : undefined;
  const text = highlights ? undefined : result.text?.trim() || undefined;
  return {
    title: result.title ?? result.url,
    url: result.url,
    publishedAt: result.publishedDate ?? undefined,
    author: result.author ?? undefined,
    highlights,
    text,
  };
};

export const exaSearch = (
  client: Exa,
  config: WebConfig,
  input: WebSearchInput,
): Effect.Effect<WebSearchOutput, WebSearchError> =>
  Effect.tryPromise({
    try: async () => {
      const parsed = parseCategoryFromQuery(input.query);
      const query = parsed.query;
      const category = toExaCategory(input.filters?.category ?? parsed.category);
      const numResults = clamp(
        input.numResults ?? config.exa.search.numResults,
        1,
        config.caps.maxNumResults,
      );
      const type =
        input.mode === "fast"
          ? "fast"
          : input.mode === "deep" && config.caps.allowDeepSearch
            ? "deep-lite"
            : config.exa.search.type;
      const response = await client.search(query, {
        type,
        numResults,
        ...(category ? { category } : {}),
        ...(input.filters?.includeDomains
          ? { includeDomains: [...input.filters.includeDomains] }
          : {}),
        ...(input.filters?.excludeDomains
          ? { excludeDomains: [...input.filters.excludeDomains] }
          : {}),
        ...(input.filters?.startPublishedDate
          ? { startPublishedDate: input.filters.startPublishedDate }
          : {}),
        ...(input.filters?.endPublishedDate
          ? { endPublishedDate: input.filters.endPublishedDate }
          : {}),
        contents: {
          highlights: true,
        },
      });

      const hits = (response.results ?? [])
        .map(mapHit)
        .filter((hit): hit is WebSearchHit => hit !== null);

      return {
        provider: "exa" as const,
        query,
        hits,
        requestId: response.requestId,
        searchTime: typeof response.searchTime === "number" ? response.searchTime : undefined,
      };
    },
    catch: (cause) =>
      new WebSearchError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
