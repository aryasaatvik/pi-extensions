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

export const SearchSettings = Schema.Struct({
  defaultIncludeDetails: Schema.Boolean,
  showSourcesFooter: Schema.Boolean,
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
};

export const DefaultExecutorSettings: ExecutorSettings = {
  displayMode: "balanced",
  render: DefaultRenderSettings,
  search: DefaultSearchSettings,
};
