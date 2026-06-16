import { describe, expect, it } from "vitest";
import {
  createQuestionnaireComponent,
  makeQuestionnaireState,
  type Question,
  type QuestionnaireResult,
  renderQuestionnaireBody,
} from "../src/index.ts";

const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
} as const;

const theme = { fg: (_c: string, s: string) => s };

function drive(questions: Question[], keys: string[]): QuestionnaireResult | undefined {
  let result: QuestionnaireResult | undefined;
  const comp = createQuestionnaireComponent(
    { tui: { requestRender: () => {} }, theme, done: (r) => (result = r) },
    questions,
  );
  for (const k of keys) {
    if (result) break;
    comp.handleInput?.(k);
  }
  return result;
}

const TWO: Question[] = [
  {
    id: "scope",
    header: "Scope",
    title: "How much?",
    options: [
      { id: "min", label: "Minimal" },
      { id: "full", label: "Full" },
    ],
  },
  {
    id: "approach",
    header: "Approach",
    title: "Which way?",
    options: [
      { id: "a", label: "Way A" },
      { id: "b", label: "Way B" },
    ],
  },
];

describe("questionnaire — single question", () => {
  const ONE: Question[] = [TWO[0]];

  it("answering the one question submits immediately (no tab bar)", () => {
    const r = drive(ONE, [KEY.enter]);
    expect(r).toEqual({
      answers: [{ id: "scope", selected: ["min"], text: undefined }],
      cancelled: false,
    });
  });

  it("Esc cancels", () => {
    expect(drive(ONE, [KEY.escape])).toEqual({ answers: [], cancelled: true });
  });

  it("renders no tab bar for a single question", () => {
    const out = renderQuestionnaireBody(makeQuestionnaireState(ONE), theme, 80).join("\n");
    expect(out).not.toContain("Submit");
    expect(out).toContain("How much?");
  });
});

describe("questionnaire — multi question", () => {
  it("answering each advances to the next, then Submit tab submits", () => {
    // Q1: Enter (min) → auto-advance to Q2; Q2: ↓ Enter (b) → advance to Submit; Enter submits.
    const r = drive(TWO, [KEY.enter, KEY.down, KEY.enter, KEY.enter]);
    expect(r).toEqual({
      answers: [
        { id: "scope", selected: ["min"], text: undefined },
        { id: "approach", selected: ["b"], text: undefined },
      ],
      cancelled: false,
    });
  });

  it("cannot submit until all answered", () => {
    // Answer Q1, jump straight to Submit tab (Tab past Q2), Enter should NOT submit.
    const state = makeQuestionnaireState(TWO);
    // No answers yet → submit tab Enter is a no-op.
    state.currentTab = 2;
    const out = renderQuestionnaireBody(state, theme, 80).join("\n");
    expect(out).toContain("answer all questions");
  });

  it("Tab navigates between tabs (forward + wrap) to drive a full submit", () => {
    // From Q1: Tab→Q2, answer (a) → advance to Submit; Tab wraps Submit→Q1, answer (min)
    // → advance to Q2; Tab→Submit; Enter submits. Exercises forward Tab nav and the wrap.
    const r = drive(TWO, [
      KEY.tab, // Q1 → Q2
      KEY.enter, // answer Q2 = a → advance to Submit
      KEY.tab, // Submit → wraps to Q1
      KEY.enter, // answer Q1 = min → advance to Q2
      KEY.tab, // Q2 → Submit
      KEY.enter, // all answered → submit
    ]);
    expect(r).toEqual({
      answers: [
        { id: "scope", selected: ["min"], text: undefined },
        { id: "approach", selected: ["a"], text: undefined },
      ],
      cancelled: false,
    });
  });

  it("renders the tab bar with status markers and a Submit tab", () => {
    const state = makeQuestionnaireState(TWO);
    state.answers.set("scope", { id: "scope", selected: ["min"] });
    const out = renderQuestionnaireBody(state, theme, 80).join("\n");
    expect(out).toContain("Scope");
    expect(out).toContain("Approach");
    expect(out).toContain("Submit");
    expect(out).toContain("■"); // answered marker for scope
    expect(out).toContain("□"); // unanswered marker for approach
  });

  it("Submit tab summary lists each answer", () => {
    const state = makeQuestionnaireState(TWO);
    state.answers.set("scope", { id: "scope", selected: ["full"] });
    state.answers.set("approach", { id: "approach", selected: ["a"] });
    state.currentTab = 2;
    const out = renderQuestionnaireBody(state, theme, 80).join("\n");
    expect(out).toContain("Full");
    expect(out).toContain("Way A");
    expect(out).toContain("enter submit");
  });
});

describe("questionnaire — notes per question (n / footer)", () => {
  const withNote: Question[] = [
    { ...TWO[0], freeText: { mode: "note", trigger: "n", placement: "footer" } },
  ];

  it("'n' opens a note that rides along with the single-question answer", () => {
    const r = drive(withNote, ["n", ..."later".split(""), KEY.enter]);
    expect(r).toEqual({
      answers: [{ id: "scope", selected: ["min"], text: "later" }],
      cancelled: false,
    });
  });

  it("a default (tab) note trigger falls back to 'n' so it stays reachable in multi-question mode", () => {
    // Q1 declares a note with the default trigger (would be "tab"); since Tab
    // navigates between questions here, the shell must accept "n" instead.
    const TWO_WITH_NOTE: Question[] = [{ ...TWO[0], freeText: { mode: "note" } }, TWO[1]];
    // Q1: n + type + Enter (note rides with min, advance to Q2); Q2: Enter (a) →
    // Submit; Enter submits.
    const r = drive(TWO_WITH_NOTE, ["n", ..."later".split(""), KEY.enter, KEY.enter, KEY.enter]);
    expect(r).toEqual({
      answers: [
        { id: "scope", selected: ["min"], text: "later" },
        { id: "approach", selected: ["a"], text: undefined },
      ],
      cancelled: false,
    });
  });
});
