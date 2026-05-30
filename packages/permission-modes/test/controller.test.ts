import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionController, getSharedController } from "../src/controller.ts";

// Hermetic rule source: the controller reads merged disk rules via loadRuleSet,
// which we replace so tests don't depend on the machine's ~/.claude or repo files.
const mockState = { allow: [] as string[], deny: [] as string[], ask: [] as string[] };
const mockWritten: string[] = [];

vi.mock("../src/rules/sources.ts", () => ({
  loadRuleSet: () => ({
    allow: [...mockState.allow],
    deny: [...mockState.deny],
    ask: [...mockState.ask],
  }),
  addAlwaysRule: (_cwd: string, rule: string) => {
    mockWritten.push(rule);
    return "/tmp/permissions.json";
  },
}));

/** Raw key sequences the overlay's handleInput understands (see matchesKey). */
const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  backspace: "\x7f",
} as const;

/**
 * Fake UI that drives the real `promptForTool` custom overlay with a scripted
 * list of keystrokes, then resolves with the overlay's `done(result)` value.
 * This exercises the actual select/Tab/note logic, not a stub. `promptCount`
 * tracks how many times the overlay was opened (for re-prompt assertions).
 */
function makeUi(keys: string[]): { ui: ExtensionContext["ui"]; promptCount: () => number } {
  let count = 0;
  const ui = {
    custom: async <T>(
      factory: (
        tui: unknown,
        theme: unknown,
        kb: unknown,
        done: (result: T) => void,
      ) => { render: () => string[]; handleInput: (data: string) => void },
    ): Promise<T> => {
      count++;
      let resolved: T | undefined;
      let settled = false;
      const done = (result: T) => {
        resolved = result;
        settled = true;
      };
      const tui = { requestRender: () => {} };
      const theme = { fg: (_c: string, s: string) => s };
      const comp = factory(tui, theme, {}, done);
      for (const k of keys) {
        if (settled) break;
        comp.handleInput(k);
      }
      if (!settled) throw new Error("overlay did not resolve from scripted keys");
      return resolved as T;
    },
    notify: () => {},
  } as unknown as ExtensionContext["ui"];
  return { ui, promptCount: () => count };
}

beforeEach(() => {
  mockState.allow = [];
  mockState.deny = [];
  mockState.ask = [];
  mockWritten.length = 0;
});

describe("PermissionController.check — modes (no bash, so no parser needed)", () => {
  it("plan mode blocks mutating tools", async () => {
    const c = new PermissionController();
    c.setMode("plan");
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: false,
    });
    expect(r?.block).toBe(true);
  });

  it("plan mode allows read", async () => {
    const c = new PermissionController();
    c.setMode("plan");
    const r = await c.check({
      toolName: "read",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: false,
    });
    expect(r).toBeUndefined();
  });

  it("bypass allows mutation", async () => {
    const c = new PermissionController();
    c.setMode("bypass");
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: false,
    });
    expect(r).toBeUndefined();
  });

  it("acceptEdits auto-allows edit", async () => {
    const c = new PermissionController();
    c.setMode("acceptEdits");
    const r = await c.check({
      toolName: "edit",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: false,
    });
    expect(r).toBeUndefined();
  });

  it("explicit deny rule beats bypass", async () => {
    mockState.deny = ["Write"];
    const c = new PermissionController();
    c.setMode("bypass");
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: false,
    });
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain("deny rule");
  });
});

describe("PermissionController.check — prompting & propagation", () => {
  it("background (non-interactive) fails closed on a gated mutation", async () => {
    const c = new PermissionController();
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: false,
      originLabel: "general-purpose",
    });
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain("no interactive prompt");
    expect(r?.reason).toContain("general-purpose");
  });

  it("'Yes' (enter on first option) allows the call", async () => {
    const c = new PermissionController();
    const { ui, promptCount } = makeUi([KEY.enter]);
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: true,
      ui,
    });
    expect(r).toBeUndefined();
    expect(promptCount()).toBe(1);
  });

  it("'No' (down to last option, enter) blocks the call", async () => {
    const c = new PermissionController();
    const { ui } = makeUi([KEY.down, KEY.down, KEY.down, KEY.enter]);
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: true,
      ui,
    });
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain("Denied by user");
  });

  it("escape blocks the call", async () => {
    const c = new PermissionController();
    const { ui } = makeUi([KEY.escape]);
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: true,
      ui,
    });
    expect(r?.block).toBe(true);
  });

  it("a 'session' grant propagates to later calls without re-prompting", async () => {
    const c = new PermissionController();
    // down once → "Yes, allow for the rest of this session", enter.
    const { ui, promptCount } = makeUi([KEY.down, KEY.enter]);
    const first = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: true,
      ui,
    });
    expect(first).toBeUndefined();
    expect(c.sessionAllow.has("Write(/tmp/x/**)")).toBe(true);
    expect(promptCount()).toBe(1);

    // A different file in the same dir — even a background caller — is now
    // covered by the shared session grant, with no new prompt.
    const second = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/b.ts" },
      cwd: "/tmp/x",
      interactive: false,
    });
    expect(second).toBeUndefined();
    expect(promptCount()).toBe(1);
  });

  it("Tab on 'No' + typed note → block with the note as the redirect reason", async () => {
    const c = new PermissionController();
    // down to "No", Tab to open the note field, type the note, enter.
    const { ui } = makeUi([KEY.down, KEY.down, KEY.down, KEY.tab, "use amend", KEY.enter]);
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: true,
      ui,
    });
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain("use amend");
  });

  it("Tab on 'Yes' + typed note → allow AND deliver the note via sendNote", async () => {
    const c = new PermissionController();
    const sent: string[] = [];
    const { ui } = makeUi([KEY.tab, "also lint", KEY.enter]);
    const r = await c.check({
      toolName: "write",
      input: { path: "/tmp/x/a.ts" },
      cwd: "/tmp/x",
      interactive: true,
      ui,
      sendNote: (t: string) => sent.push(t),
    });
    expect(r).toBeUndefined();
    expect(sent).toEqual(["also lint"]);
  });
});

describe("getSharedController", () => {
  it("returns the same process-wide instance", () => {
    expect(getSharedController()).toBe(getSharedController());
  });
});
