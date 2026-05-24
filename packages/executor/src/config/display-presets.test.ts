import { describe, expect, it } from "vitest";

import {
  applyDisplayMode,
  inferDisplayMode,
  normalizeExecutorSettings,
  settingsMatchPreset,
} from "./display-presets.ts";
import { DefaultExecutorSettings } from "../schemas/settings.ts";

describe("display presets", () => {
  it("applies concise and verbose presets", () => {
    const concise = applyDisplayMode("concise");
    expect(concise.render.maxJsonBytes).toBe(12_000);
    expect(concise.search.defaultIncludeDetails).toBe(false);

    const verbose = applyDisplayMode("verbose");
    expect(verbose.render.maxLogLines).toBe(500);
    expect(verbose.search.defaultIncludeDetails).toBe(true);
  });

  it("infers balanced from defaults", () => {
    expect(inferDisplayMode(DefaultExecutorSettings)).toBe("balanced");
  });

  it("marks modified settings as custom", () => {
    const custom = normalizeExecutorSettings({
      displayMode: "balanced",
      render: { ...DefaultExecutorSettings.render, maxLogLines: 12 },
      search: DefaultExecutorSettings.search,
    });

    expect(custom.displayMode).toBe("custom");
    expect(settingsMatchPreset(custom, "balanced")).toBe(false);
  });
});
