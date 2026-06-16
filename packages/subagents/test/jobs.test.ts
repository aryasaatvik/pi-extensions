import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { StartSpec } from "../src/services/jobs.ts";
import { createJobs } from "../src/services/jobs.ts";

// Control the child run so jobs never spawn a real Agent; capture each request
// so we can assert settings are threaded into the SpawnRequest.
const mockRuns: Array<(result: unknown) => void> = [];
const mockReqs: Array<{ outputCapBytes: number; defaultModel?: string }> = [];
vi.mock("../src/services/spawn.ts", () => ({
  runSubagent: (req: { outputCapBytes: number; defaultModel?: string }) => {
    mockReqs.push(req);
    return new Promise((resolve) => mockRuns.push(resolve));
  },
}));

const sent: Array<{ text: string }> = [];
const piStub = {
  sendUserMessage: (content: unknown) => sent.push({ text: String(content) }),
} as unknown as ExtensionAPI;

describe("JobsService background lifecycle", () => {
  let cwd: string;
  const spec = (): StartSpec => ({
    def: {
      name: "explore",
      description: "d",
      tools: ["read"],
      systemPrompt: "",
      source: "builtin",
    },
    prompt: "do the thing",
    description: "the thing",
    cwd,
    registry: {} as never,
    parentModel: undefined,
    ui: {} as never,
  });

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "subagents-jobs-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "pi-subagents.json"),
      JSON.stringify({
        maxConcurrentPerSession: 1,
        maxConcurrentGlobal: 5,
        outputCapBytes: 1000,
        defaultModel: "openai/gpt-x",
      }),
    );
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
    mockRuns.length = 0;
    mockReqs.length = 0;
    sent.length = 0;
  });

  it("starts, enforces the per-session cap, completes with injection, and cancels", async () => {
    const jobs = createJobs(piStub);

    const started1 = await Effect.runPromise(jobs.start(spec()));
    expect(started1).toHaveProperty("taskId");
    const id1 = (started1 as { taskId: string }).taskId;

    const running = await Effect.runPromise(jobs.list());
    expect(running.find((v) => v.id === id1)?.status).toBe("running");

    // Settings must be threaded into the spawn request (output cap + default model).
    expect(mockReqs[0]?.outputCapBytes).toBe(1000);
    expect(mockReqs[0]?.defaultModel).toBe("openai/gpt-x");

    // per-session cap is 1, so a second concurrent start is rejected.
    const started2 = await Effect.runPromise(jobs.start(spec()));
    expect(started2).toHaveProperty("error");

    // complete the first job.
    expect(mockRuns).toHaveLength(1);
    mockRuns[0]?.({
      text: "all done",
      isError: false,
      details: {
        agentType: "explore",
        description: "the thing",
        status: "done",
        toolCalls: [],
        tokens: 42,
        background: true,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const out = await Effect.runPromise(jobs.output(id1));
    expect(out?.status).toBe("done");
    expect(out?.text).toBe("all done");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("all done");

    // under the cap again: start a new one, then cancel it.
    const started3 = await Effect.runPromise(jobs.start(spec()));
    expect(started3).toHaveProperty("taskId");
    const canceled = await Effect.runPromise(jobs.cancel("all"));
    expect(canceled).toBe(1);
  });
});

describe("JobsService global slot accounting", () => {
  const GLOBAL_KEY = Symbol.for("@pi-ext/subagents.globalRunning");
  let cwd: string;
  const spec = (): StartSpec => ({
    def: {
      name: "explore",
      description: "d",
      tools: ["read"],
      systemPrompt: "",
      source: "builtin",
    },
    prompt: "p",
    description: "the thing",
    cwd,
    registry: {} as never,
    parentModel: undefined,
    ui: {} as never,
  });

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "subagents-global-"));
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "pi-subagents.json"),
      JSON.stringify({ maxConcurrentPerSession: 5, maxConcurrentGlobal: 1, outputCapBytes: 1000 }),
    );
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
    mockRuns.length = 0;
  });

  it("holds the global slot until the run settles, not at cancel()", async () => {
    (globalThis as unknown as Record<symbol, { n: number }>)[GLOBAL_KEY] = { n: 0 };
    mockRuns.length = 0;
    const jobs = createJobs(piStub);

    expect(await Effect.runPromise(jobs.start(spec()))).toHaveProperty("taskId");

    // cancel() only requests the abort; the child is still draining.
    expect(await Effect.runPromise(jobs.cancel("all"))).toBe(1);

    // Slot is still held, so a new start is rejected by the global cap — the old
    // behavior (decrement on cancel) would have wrongly admitted this one.
    const blocked = await Effect.runPromise(jobs.start(spec()));
    expect(blocked).toHaveProperty("error");
    expect((blocked as { error: string }).error).toContain("Global");

    // The run actually settles → the slot is released exactly once.
    expect(mockRuns).toHaveLength(1);
    mockRuns[0]?.({
      text: "late",
      isError: true,
      details: {
        agentType: "explore",
        description: "the thing",
        status: "canceled",
        toolCalls: [],
        tokens: 0,
        background: true,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Freed → a new start now succeeds.
    expect(await Effect.runPromise(jobs.start(spec()))).toHaveProperty("taskId");
  });
});
