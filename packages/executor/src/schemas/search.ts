import { Type, type Static } from "@earendil-works/pi-ai";
import { Schema } from "effect";

export const SearchInput = Type.Object({
  query: Type.String({
    description:
      "Short intent phrase to search for, such as github issues or create calendar event.",
  }),
  namespace: Type.Optional(
    Type.String({
      description: "Optional Executor namespace to narrow results, such as github.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum results to return. Defaults to 12.",
    }),
  ),
  offset: Type.Optional(
    Type.Number({
      description: "Pagination offset from a previous search result.",
    }),
  ),
  includeDetails: Type.Optional(
    Type.Boolean({
      description: "Include compact TypeScript input/output shapes for each matched tool.",
    }),
  ),
});

export type SearchInput = Static<typeof SearchInput>;

export const SearchToolDetails = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputTypeScript: Schema.optional(Schema.String),
  outputTypeScript: Schema.optional(Schema.String),
  typeScriptDefinitions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export type SearchToolDetails = typeof SearchToolDetails.Type;

export const SearchResultItem = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  integration: Schema.String,
  score: Schema.Number,
  details: Schema.optional(SearchToolDetails),
});

export type SearchResultItem = typeof SearchResultItem.Type;

export const SearchDetails = Schema.Struct({
  items: Schema.Array(SearchResultItem),
  total: Schema.Number,
  hasMore: Schema.Boolean,
  nextOffset: Schema.NullOr(Schema.Number),
  searchMode: Schema.optional(
    Schema.Union([Schema.Literal("executor"), Schema.Literal("fts"), Schema.Literal("hybrid")]),
  ),
  indexStatus: Schema.optional(Schema.String),
  indexedTools: Schema.optional(Schema.Number),
  indexedEmbeddings: Schema.optional(Schema.Number),
});

export type SearchDetails = typeof SearchDetails.Type;
