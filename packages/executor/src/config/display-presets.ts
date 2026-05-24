import {
  type DisplayMode,
  type ExecutorSettings,
  DefaultExecutorSettings,
  DefaultRenderSettings,
  DefaultSearchSettings,
  type RenderSettings,
  type SearchSettings,
} from "../schemas/settings.ts";

export interface DisplayPreset {
  readonly render: RenderSettings;
  readonly search: SearchSettings;
}

export const displayPresets: Record<Exclude<DisplayMode, "custom">, DisplayPreset> = {
  concise: {
    render: {
      maxCodePreviewLines: 24,
      maxJsonBytes: 12_000,
      maxLogLines: 40,
    },
    search: {
      defaultIncludeDetails: false,
      showSourcesFooter: false,
    },
  },
  balanced: {
    render: DefaultRenderSettings,
    search: DefaultSearchSettings,
  },
  verbose: {
    render: {
      maxCodePreviewLines: 120,
      maxJsonBytes: 100_000,
      maxLogLines: 500,
    },
    search: {
      defaultIncludeDetails: true,
      showSourcesFooter: true,
    },
  },
};

export const applyDisplayMode = (mode: Exclude<DisplayMode, "custom">): ExecutorSettings => ({
  displayMode: mode,
  render: { ...displayPresets[mode].render },
  search: { ...displayPresets[mode].search },
});

export const settingsMatchPreset = (
  settings: ExecutorSettings,
  mode: Exclude<DisplayMode, "custom">,
): boolean => {
  const preset = displayPresets[mode];
  return (
    settings.render.maxCodePreviewLines === preset.render.maxCodePreviewLines &&
    settings.render.maxJsonBytes === preset.render.maxJsonBytes &&
    settings.render.maxLogLines === preset.render.maxLogLines &&
    settings.search.defaultIncludeDetails === preset.search.defaultIncludeDetails &&
    settings.search.showSourcesFooter === preset.search.showSourcesFooter
  );
};

export const inferDisplayMode = (settings: ExecutorSettings): DisplayMode => {
  if (settings.displayMode === "custom") {
    return "custom";
  }

  for (const mode of ["concise", "balanced", "verbose"] as const) {
    if (settingsMatchPreset(settings, mode)) {
      return mode;
    }
  }

  return "custom";
};

export const normalizeExecutorSettings = (settings: ExecutorSettings): ExecutorSettings => {
  const displayMode = inferDisplayMode(settings);
  if (displayMode === "custom") {
    return { ...settings, displayMode: "custom" };
  }

  return applyDisplayMode(displayMode);
};

export const formatDisplayModeLabel = (mode: DisplayMode): string => {
  switch (mode) {
    case "concise":
      return "concise";
    case "balanced":
      return "balanced";
    case "verbose":
      return "verbose";
    case "custom":
      return "custom";
  }
};
