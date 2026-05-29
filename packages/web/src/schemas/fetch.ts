import { Type, type Static } from "@earendil-works/pi-ai";
import { Schema } from "effect";

export const WebFetchToolInput = Type.Object({
  urls: Type.Array(Type.String({ description: "HTTP(S) URLs to fetch." }), {
    minItems: 1,
    description: "URLs to read. Batch multiple URLs in one call.",
  }),
  target: Type.Optional(
    Type.String({
      description: "Specific information to extract from the page. Omit for general page content.",
    }),
  ),
  maxCharacters: Type.Optional(
    Type.Number({
      description: "Maximum characters to extract per page (default 3000).",
    }),
  ),
  freshness: Type.Optional(
    Type.Union([Type.Literal("cached"), Type.Literal("fresh"), Type.Literal("auto")], {
      description: "Freshness preference. Defaults to auto.",
    }),
  ),
});

export type WebFetchToolInput = Static<typeof WebFetchToolInput>;

export const WebFetchToolDetails = Schema.Struct({
  provider: Schema.Union([Schema.Literal("exa"), Schema.Literal("parallel")]),
  urlCount: Schema.Number,
  searchTime: Schema.optional(Schema.Number),
  compactText: Schema.optional(Schema.String),
  expandedText: Schema.optional(Schema.String),
});

export type WebFetchToolDetails = typeof WebFetchToolDetails.Type;
