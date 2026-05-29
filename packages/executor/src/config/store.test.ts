import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyDisplayMode } from "./display-presets.ts";
import * as paths from "./paths.ts";
import { loadExecutorPiSettings, saveGlobalExecutorPiSettings } from "./store.ts";
import { DefaultExecutorSettings } from "../schemas/settings.ts";

describe("executor config store", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "executor-config-"));
    vi.spyOn(paths, "globalExecutorPiConfigPath").mockReturnValue(
      join(tempDir, "executor-pi.json"),
    );
    vi.spyOn(paths, "projectExecutorPiConfigPath").mockImplementation((cwd) =>
      join(cwd, ".pi", "executor-pi.json"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns defaults when no config files exist", () => {
    const settings = Effect.runSync(loadExecutorPiSettings("/tmp/project"));
    expect(settings.displayMode).toBe("balanced");
    expect(settings.render).toEqual(DefaultExecutorSettings.render);
  });

  it("loads global config and merges project overrides", () => {
    const projectDir = join(tempDir, "project");
    mkdirSync(join(projectDir, ".pi"), { recursive: true });

    writeFileSync(join(tempDir, "executor-pi.json"), JSON.stringify(applyDisplayMode("verbose")));
    writeFileSync(
      join(projectDir, ".pi", "executor-pi.json"),
      JSON.stringify({
        displayMode: "custom",
        render: { maxCodePreviewLines: 40, maxJsonBytes: 40_000, maxLogLines: 200 },
        search: { defaultIncludeDetails: false, showSourcesFooter: true, mode: "hybrid" },
      }),
    );

    const settings = Effect.runSync(loadExecutorPiSettings(projectDir));
    expect(settings.displayMode).toBe("custom");
    expect(settings.render.maxCodePreviewLines).toBe(40);
    expect(settings.search.defaultIncludeDetails).toBe(false);
  });

  it("persists global settings", () => {
    const verbose = applyDisplayMode("verbose");
    Effect.runSync(saveGlobalExecutorPiSettings(verbose));

    const settings = Effect.runSync(loadExecutorPiSettings("/tmp/project"));
    expect(settings.displayMode).toBe("verbose");
    expect(settings.render.maxLogLines).toBe(500);
  });
});
