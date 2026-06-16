import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { AskToolInput } from "../src/schemas/ask.ts";
import { makeAskTool } from "../src/tools/ask.ts";

const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  escape: "\x1b",
} as const;

/**
 * Build a fake ExtensionContext whose `ui.custom` drives the real overlay
 * component with a scripted list of keystrokes and resolves with `done()`.
 */
function mockCtx(hasUI: boolean, keys: string[]): ExtensionContext {
  const ui = {
    custom: async <T>(
      factory: (
        tui: unknown,
        theme: unknown,
        kb: unknown,
        done: (result: T) => void,
      ) => { handleInput?: (data: string) => void },
    ): Promise<T> => {
      let resolved: T | undefined;
      let settled = false;
      const done = (r: T) => {
        resolved = r;
        settled = true;
      };
      const tui = { requestRender: () => {} };
      const theme = { fg: (_c: string, s: string) => s };
      const comp = factory(tui, theme, {}, done);
      for (const k of keys) {
        if (settled) break;
        comp.handleInput?.(k);
      }
      if (!settled) throw new Error("overlay did not resolve from scripted keys");
      return resolved as T;
    },
  };
  return { hasUI, ui } as unknown as ExtensionContext;
}

const ONE = {
  questions: [
    {
      question: "Which package manager?",
      header: "PkgMgr",
      options: [
        { label: "Bun", description: "Fast all-in-one" },
        { label: "pnpm", description: "Strict, disk-efficient" },
      ],
    },
  ],
};

const tool = makeAskTool();

async function run(ctx: ExtensionContext, params: unknown) {
  return tool.execute("call-1", params as never, undefined, undefined, ctx);
}

describe("ask schema", () => {
  it("accepts a well-formed single question", () => {
    expect(Value.Check(AskToolInput, ONE)).toBe(true);
  });

  it("rejects a question with fewer than 2 options", () => {
    const bad = {
      questions: [{ ...ONE.questions[0], options: [{ label: "x", description: "y" }] }],
    };
    expect(Value.Check(AskToolInput, bad)).toBe(false);
  });

  it("rejects more than 4 questions", () => {
    const bad = { questions: Array.from({ length: 5 }, () => ONE.questions[0]) };
    expect(Value.Check(AskToolInput, bad)).toBe(false);
  });
});

describe("ask execute — non-interactive", () => {
  it("returns a graceful message when no UI is attached", async () => {
    const res = await run(mockCtx(false, []), ONE);
    expect(res.details?.cancelled).toBe(true);
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    expect(text).toContain("no interactive UI");
  });
});

describe("ask execute — single question", () => {
  it("selecting the first option returns its label", async () => {
    const res = await run(mockCtx(true, [KEY.enter]), ONE);
    expect(res.details?.cancelled).toBe(false);
    expect(res.details?.answers[0]).toMatchObject({ header: "PkgMgr", selectedLabels: ["Bun"] });
    expect(res.content[0].type === "text" && res.content[0].text).toContain("PkgMgr: Bun");
  });

  it("↓ then Enter selects the second option", async () => {
    const res = await run(mockCtx(true, [KEY.down, KEY.enter]), ONE);
    expect(res.details?.answers[0].selectedLabels).toEqual(["pnpm"]);
  });

  it("a note typed via 'n' rides along with the selection", async () => {
    const res = await run(mockCtx(true, ["n", ..."prefer bun".split(""), KEY.enter]), ONE);
    expect(res.details?.answers[0]).toMatchObject({ selectedLabels: ["Bun"], text: "prefer bun" });
    expect(res.content[0].type === "text" && res.content[0].text).toContain("note: prefer bun");
  });

  it("Esc dismisses and reports back to the model", async () => {
    const res = await run(mockCtx(true, [KEY.escape]), ONE);
    expect(res.details?.cancelled).toBe(true);
    expect(res.content[0].type === "text" && res.content[0].text).toContain("dismissed");
  });
});

describe("ask execute — multi question", () => {
  const TWO = {
    questions: [
      ONE.questions[0],
      {
        question: "Run tests?",
        header: "Tests",
        options: [
          { label: "Yes", description: "Run the suite" },
          { label: "No", description: "Skip" },
        ],
      },
    ],
  };

  it("answers each question then submits on the Submit tab", async () => {
    // Q1: Enter (Bun) → advance to Q2; Q2: ↓ Enter (No) → advance to Submit; Enter submits.
    const res = await run(mockCtx(true, [KEY.enter, KEY.down, KEY.enter, KEY.enter]), TWO);
    expect(res.details?.cancelled).toBe(false);
    expect(res.details?.answers.map((a) => a.selectedLabels)).toEqual([["Bun"], ["No"]]);
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    expect(text).toContain("PkgMgr: Bun");
    expect(text).toContain("Tests: No");
  });
});
