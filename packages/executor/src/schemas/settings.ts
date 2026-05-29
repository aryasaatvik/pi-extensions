import { Schema } from "effect";

export const DisplayMode = Schema.Union([
  Schema.Literal("concise"),
  Schema.Literal("balanced"),
  Schema.Literal("verbose"),
  Schema.Literal("custom"),
]);

export type DisplayMode = typeof DisplayMode.Type;

export const RenderSettings = Schema.Struct({
  maxCodePreviewLines: Schema.Number,
  maxLogLines: Schema.Number,
  maxJsonBytes: Schema.Number,
});

export type RenderSettings = typeof RenderSettings.Type;

export const SearchMode = Schema.Union([
  Schema.Literal("executor"),
  Schema.Literal("fts"),
  Schema.Literal("hybrid"),
]);

export type SearchMode = typeof SearchMode.Type;

export const SearchSettings = Schema.Struct({
  defaultIncludeDetails: Schema.Boolean,
  showSourcesFooter: Schema.Boolean,
  mode: SearchMode,
  embeddings: Schema.optional(
    Schema.Union([
      Schema.Struct({
        provider: Schema.Literal("openai-compatible"),
        baseUrl: Schema.String,
        model: Schema.String,
        authProvider: Schema.optional(Schema.String),
        dimensions: Schema.Number,
        batchSize: Schema.optional(Schema.Number),
      }),
      Schema.Struct({
        provider: Schema.Literal("gemini"),
        model: Schema.String,
        authProvider: Schema.optional(Schema.String),
        dimensions: Schema.Number,
        batchSize: Schema.optional(Schema.Number),
      }),
    ]),
  ),
});

export type SearchSettings = typeof SearchSettings.Type;

export const ExecutorSettings = Schema.Struct({
  displayMode: DisplayMode,
  render: RenderSettings,
  search: SearchSettings,
});

export type ExecutorSettings = typeof ExecutorSettings.Type;

export const DefaultRenderSettings: RenderSettings = {
  maxCodePreviewLines: 80,
  maxJsonBytes: 40_000,
  maxLogLines: 200,
};

export const DefaultSearchSettings: SearchSettings = {
  defaultIncludeDetails: false,
  showSourcesFooter: true,
  mode: "fts",
};

export const DefaultExecutorSettings: ExecutorSettings = {
  displayMode: "balanced",
  render: DefaultRenderSettings,
  search: DefaultSearchSettings,
};
