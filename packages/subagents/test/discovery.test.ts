import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUILTIN_AGENTS } from "../src/agents/builtins.ts";
import { discoverAgents } from "../src/agents/discovery.ts";
import { listAgents, resolveAgent } from "../src/agents/registry.ts";

describe("agent discovery + registry", () => {
  let cwd: string;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "subagents-"));
    const dir = join(cwd, ".pi", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews code\ntools: read, grep\n---\nYou review code.\n",
    );
    // Missing name → must be skipped.
    writeFileSync(join(dir, "nameless.md"), "---\ndescription: missing name\n---\nbody\n");
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("parses project agents and skips entries missing name/description", () => {
    const found = discoverAgents(cwd);
    const reviewer = found.find((a) => a.name === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer?.tools).toEqual(["read", "grep"]);
    expect(reviewer?.source).toBe("project");
    expect(reviewer?.systemPrompt).toBe("You review code.");
    expect(found.some((a) => a.description === "missing name")).toBe(false);
  });

  it("listAgents overlays project agents on top of builtins", () => {
    const names = listAgents(cwd).map((a) => a.name);
    for (const builtin of BUILTIN_AGENTS) expect(names).toContain(builtin.name);
    expect(names).toContain("reviewer");
  });

  it("resolveAgent finds builtins and project agents, undefined otherwise", () => {
    expect(resolveAgent(cwd, "explore")?.source).toBe("builtin");
    expect(resolveAgent(cwd, "reviewer")?.source).toBe("project");
    expect(resolveAgent(cwd, "does-not-exist")).toBeUndefined();
  });
});
