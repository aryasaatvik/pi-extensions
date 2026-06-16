import { describe, expect, it } from "vitest";
import {
  type ChoiceResult,
  type ChoiceSpec,
  createChoiceComponent,
  makeChoiceState,
  renderChoiceBody,
} from "../src/index.ts";

const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  backspace: "\x7f",
  space: " ",
} as const;

const theme = { fg: (_c: string, s: string) => s };

/** Drive the real component with a scripted list of keystrokes. */
function drive(spec: ChoiceSpec, keys: string[]): ChoiceResult | undefined {
  let result: ChoiceResult | undefined;
  const comp = createChoiceComponent(
    { tui: { requestRender: () => {} }, theme, done: (r) => (result = r) },
    spec,
  );
  for (const k of keys) {
    if (result) break;
    comp.handleInput?.(k);
  }
  return result;
}

const ABC: ChoiceSpec = {
  title: "Pick one",
  options: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
  ],
};

describe("choice — single select", () => {
  it("Enter selects the focused option", () => {
    expect(drive(ABC, [KEY.enter])).toEqual({ selected: ["a"], cancelled: false });
  });

  it("↓↓ then Enter selects the third option", () => {
    expect(drive(ABC, [KEY.down, KEY.down, KEY.enter])).toEqual({
      selected: ["c"],
      cancelled: false,
    });
  });

  it("↑ clamps at the top", () => {
    expect(drive(ABC, [KEY.up, KEY.up, KEY.enter])).toEqual({ selected: ["a"], cancelled: false });
  });

  it("Esc cancels", () => {
    expect(drive(ABC, [KEY.escape])).toEqual({ selected: [], cancelled: true });
  });
});

describe("choice — multi select", () => {
  const spec: ChoiceSpec = { ...ABC, multiSelect: true };

  it("Space toggles, Enter confirms the set", () => {
    const r = drive(spec, [KEY.space, KEY.down, KEY.down, KEY.space, KEY.enter]);
    expect(r).toEqual({ selected: ["a", "c"], cancelled: false });
  });

  it("toggling twice removes a selection", () => {
    const r = drive(spec, [KEY.space, KEY.space, KEY.down, KEY.space, KEY.enter]);
    expect(r).toEqual({ selected: ["b"], cancelled: false });
  });

  it("Enter with nothing selected confirms an empty set", () => {
    expect(drive(spec, [KEY.enter])).toEqual({ selected: [], cancelled: false });
  });
});

describe("choice — note (inline / tab)", () => {
  const spec: ChoiceSpec = {
    ...ABC,
    freeText: { mode: "note", trigger: "tab", placement: "inline" },
  };

  it("Tab opens the note, typing + Enter submits selection + note", () => {
    const r = drive(spec, [KEY.down, KEY.tab, ..."use amend".split(""), KEY.enter]);
    expect(r).toEqual({ selected: ["b"], text: "use amend", cancelled: false });
  });

  it("Backspace edits the note", () => {
    const r = drive(spec, [KEY.tab, ..."abx".split(""), KEY.backspace, KEY.enter]);
    expect(r).toEqual({ selected: ["a"], text: "ab", cancelled: false });
  });

  it("Esc in note mode returns to the list (no submit)", () => {
    const r = drive(spec, [KEY.tab, ..."xy".split(""), KEY.escape, KEY.enter]);
    expect(r).toEqual({ selected: ["a"], cancelled: false });
  });

  it("renders the note inline on the focused option", () => {
    const state = makeChoiceState(spec);
    state.mode = "text";
    state.textKind = "note";
    state.buffer.value = "hi";
    const out = renderChoiceBody(state, theme, 40).join("\n");
    expect(out).toContain("Alpha");
    expect(out).toContain(", hi▏");
  });
});

describe("choice — note (footer / n)", () => {
  const spec: ChoiceSpec = {
    ...ABC,
    freeText: { mode: "note", trigger: "n", placement: "footer" },
  };

  it("'n' opens the footer note, then typing + Enter submits selection + note", () => {
    // The 'n' that opens the editor is the trigger (swallowed, like Tab);
    // subsequent keys form the note.
    const r = drive(spec, ["n", ..."redo".split(""), KEY.enter]);
    expect(r).toEqual({ selected: ["a"], text: "redo", cancelled: false });
  });

  it("shows the 'press n to add notes' hint when idle", () => {
    const out = renderChoiceBody(makeChoiceState(spec), theme, 40).join("\n");
    expect(out).toContain("press n to add notes");
  });
});

describe("choice — other (Type something)", () => {
  const spec: ChoiceSpec = { ...ABC, freeText: { mode: "other" } };

  it("selecting the synthetic option, typing + Enter returns typed text", () => {
    // 3 real options + 1 synthetic → ↓↓↓ focuses "Type something."
    const r = drive(spec, [
      KEY.down,
      KEY.down,
      KEY.down,
      KEY.enter,
      ..."custom".split(""),
      KEY.enter,
    ]);
    expect(r).toEqual({ selected: [], text: "custom", cancelled: false });
  });

  it("empty 'other' answer returns to the list", () => {
    const r = drive(spec, [
      KEY.down,
      KEY.down,
      KEY.down,
      KEY.enter,
      KEY.enter,
      KEY.up,
      KEY.up,
      KEY.up,
      KEY.enter,
    ]);
    expect(r).toEqual({ selected: ["a"], cancelled: false });
  });

  it("the synthetic option uses a custom label", () => {
    const custom: ChoiceSpec = { ...ABC, freeText: { mode: "other", label: "Something else" } };
    const out = renderChoiceBody(makeChoiceState(custom), theme, 40).join("\n");
    expect(out).toContain("Something else");
  });
});

describe("choice — preview pane", () => {
  const spec: ChoiceSpec = {
    title: "Pick a layout",
    options: [
      { id: "a", label: "Named groups", preview: "catalog:\n  effect\n  vitest" },
      { id: "b", label: "Single catalog", preview: "catalog:\n  everything" },
    ],
  };

  it("renders the focused option's preview in a bordered box (wide)", () => {
    const out = renderChoiceBody(makeChoiceState(spec), theme, 100).join("\n");
    expect(out).toContain("effect");
    expect(out).toContain("┌");
    expect(out).toContain("│");
  });

  it("preview follows focus", () => {
    const state = makeChoiceState(spec);
    state.index = 1;
    const out = renderChoiceBody(state, theme, 100).join("\n");
    expect(out).toContain("everything");
    expect(out).not.toContain("vitest");
  });

  it("stacks the preview below the list when too narrow to split", () => {
    const out = renderChoiceBody(makeChoiceState(spec), theme, 40).join("\n");
    expect(out).toContain("effect");
    expect(out).toContain("Named groups");
  });
});
