import { Type, type Static } from "@earendil-works/pi-ai";
import { Schema } from "effect";

export const WebSearchToolInput = Type.Object({
  query: Type.String({
    description:
      "Self-contained web research objective or search query. Describe the ideal page, not bare keywords.",
  }),
  searchQueries: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional Parallel-style keyword queries, ideally 2-3 diverse 3-6 word queries.",
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("fast"), Type.Literal("standard"), Type.Literal("deep")], {
      description: "Search depth/latency hint. Defaults to standard.",
    }),
  ),
  numResults: Type.Optional(
    Type.Number({
      description: "Number of search results to return (default 10).",
    }),
  ),
  filters: Type.Optional(
    Type.Object({
      includeDomains: Type.Optional(Type.Array(Type.String())),
      excludeDomains: Type.Optional(Type.Array(Type.String())),
      startPublishedDate: Type.Optional(Type.String()),
      endPublishedDate: Type.Optional(Type.String()),
      category: Type.Optional(
        Type.Union([
          Type.Literal("company"),
          Type.Literal("people"),
          Type.Literal("news"),
          Type.Literal("research paper"),
          Type.Literal("pdf"),
          Type.Literal("personal site"),
        ]),
      ),
      location: Type.Optional(Type.String()),
    }),
  ),
});

export type WebSearchToolInput = Static<typeof WebSearchToolInput>;

export const WebSearchToolDetails = Schema.Struct({
  provider: Schema.Union([Schema.Literal("exa"), Schema.Literal("parallel")]),
  query: Schema.String,
  hitCount: Schema.Number,
  requestId: Schema.optional(Schema.String),
  searchTime: Schema.optional(Schema.Number),
  compactText: Schema.optional(Schema.String),
  expandedText: Schema.optional(Schema.String),
});

export type WebSearchToolDetails = typeof WebSearchToolDetails.Type;
