import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { type ChoiceState, handleChoiceKey, makeChoiceState, renderChoiceBody } from "./choice.ts";
import { clip, type ThemeLike } from "./layout.ts";
import type { Answer, ChoiceSpec, Question, QuestionnaireResult } from "./types.ts";

type Ui = ExtensionContext["ui"];

/** Live state for a multi-question questionnaire. Mutated by {@link handleQuestionnaireKey}. */
export interface QuestionnaireState {
  readonly questions: Question[];
  /** One choice sub-state per question (same index). */
  readonly choices: ChoiceState[];
  /** Recorded answers, keyed by question id. */
  readonly answers: Map<string, Answer>;
  /** Focused tab: `0..questions.length-1` = a question; `questions.length` = Submit. */
  currentTab: number;
  /** True when more than one question (renders the tab bar + Submit tab). */
  readonly isMulti: boolean;
}

/** Outcome of feeding a keystroke to the questionnaire. */
export type QuestionnaireEvent =
  | { type: "none" }
  | { type: "render" }
  | { type: "submit"; result: QuestionnaireResult }
  | { type: "cancel" };

function questionToSpec(q: Question, isMulti: boolean): ChoiceSpec {
  // In a multi-question questionnaire Tab is reserved for moving between
  // questions, so a note's "tab" trigger (also the default) would never reach
  // the choice engine. Fall it back to "n" there so the note stays reachable.
  const freeText =
    isMulti && q.freeText?.mode === "note" && (q.freeText.trigger ?? "tab") === "tab"
      ? { ...q.freeText, trigger: "n" as const }
      : q.freeText;
  return {
    title: q.title,
    header: q.header,
    options: q.options,
    freeText,
    multiSelect: q.multiSelect,
  };
}

export function makeQuestionnaireState(questions: Question[]): QuestionnaireState {
  const isMulti = questions.length > 1;
  return {
    questions,
    choices: questions.map((q) => makeChoiceState(questionToSpec(q, isMulti))),
    answers: new Map<string, Answer>(),
    currentTab: 0,
    isMulti,
  };
}

function allAnswered(state: QuestionnaireState): boolean {
  return state.questions.every((q) => state.answers.has(q.id));
}

function result(state: QuestionnaireState, cancelled: boolean): QuestionnaireResult {
  return {
    answers: state.questions
      .map((q) => state.answers.get(q.id))
      .filter((a): a is Answer => a != null),
    cancelled,
  };
}

function submitTab(state: QuestionnaireState): number {
  return state.questions.length;
}

/** After answering a question, advance: single → submit; multi → next tab/Submit. */
function advance(state: QuestionnaireState): void {
  if (!state.isMulti) return;
  state.currentTab = Math.min(state.currentTab + 1, submitTab(state));
}

/** Apply a keystroke. Returns what the host overlay should do next. */
export function handleQuestionnaireKey(
  state: QuestionnaireState,
  data: string,
): QuestionnaireEvent {
  const onSubmitTab = state.currentTab === submitTab(state);
  const choice = state.choices[state.currentTab];
  const inText = !onSubmitTab && choice.mode === "text";

  // While typing a note/answer, every key belongs to the editor.
  if (inText) {
    const event = handleChoiceKey(choice, data);
    if (event.type === "submit") {
      saveAnswer(state, event.result.selected, event.result.text);
      if (!state.isMulti) return { type: "submit", result: result(state, false) };
      advance(state);
      return { type: "render" };
    }
    return event.type === "none" ? { type: "none" } : { type: "render" };
  }

  // List/Submit mode: Tab/←→ move between tabs (multi only).
  if (state.isMulti) {
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      state.currentTab = (state.currentTab + 1) % (submitTab(state) + 1);
      return { type: "render" };
    }
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
      state.currentTab = (state.currentTab - 1 + submitTab(state) + 1) % (submitTab(state) + 1);
      return { type: "render" };
    }
  }

  if (onSubmitTab) {
    if (matchesKey(data, Key.enter) && allAnswered(state)) {
      return { type: "submit", result: result(state, false) };
    }
    if (matchesKey(data, Key.escape)) return { type: "cancel" };
    return { type: "none" };
  }

  // A question tab: delegate to the choice engine.
  const event = handleChoiceKey(choice, data);
  if (event.type === "submit") {
    saveAnswer(state, event.result.selected, event.result.text);
    if (!state.isMulti) return { type: "submit", result: result(state, false) };
    advance(state);
    return { type: "render" };
  }
  if (event.type === "cancel") return { type: "cancel" };
  return event.type === "none" ? { type: "none" } : { type: "render" };
}

function saveAnswer(state: QuestionnaireState, selected: string[], text?: string): void {
  const q = state.questions[state.currentTab];
  if (!q) return;
  state.answers.set(q.id, { id: q.id, selected, text });
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderTabBar(state: QuestionnaireState, theme: ThemeLike, width: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < state.questions.length; i++) {
    const q = state.questions[i];
    const active = i === state.currentTab;
    const answered = state.answers.has(q.id);
    const box = answered ? "■" : "□";
    const text = ` ${box} ${q.header} `;
    parts.push(active ? theme.fg("accent", text) : theme.fg(answered ? "success" : "muted", text));
  }
  const onSubmit = state.currentTab === submitTab(state);
  const submitText = " ✓ Submit ";
  parts.push(
    onSubmit
      ? theme.fg("accent", submitText)
      : theme.fg(allAnswered(state) ? "success" : "dim", submitText),
  );
  return [clip(`← ${parts.join("")} →`, width), ""];
}

function renderSubmit(state: QuestionnaireState, theme: ThemeLike, width: number): string[] {
  const lines = [clip(theme.fg("accent", "Ready to submit"), width), ""];
  for (const q of state.questions) {
    const a = state.answers.get(q.id);
    const value = a ? describeAnswer(q, a) : theme.fg("warning", "—");
    lines.push(clip(`${theme.fg("muted", `${q.header}: `)}${value}`, width));
  }
  lines.push("");
  lines.push(
    allAnswered(state)
      ? clip(theme.fg("success", "enter submit · esc cancel"), width)
      : clip(theme.fg("warning", "answer all questions to submit · esc cancel"), width),
  );
  return lines;
}

function describeAnswer(q: Question, a: Answer): string {
  const labels = a.selected.map((id) => q.options.find((o) => o.id === id)?.label ?? id).join(", ");
  if (a.text && labels) return `${labels} — ${a.text}`;
  if (a.text) return a.text;
  return labels || "—";
}

/** Render the full questionnaire body for `width`. */
export function renderQuestionnaireBody(
  state: QuestionnaireState,
  theme: ThemeLike,
  width: number,
): string[] {
  const head = state.isMulti ? renderTabBar(state, theme, width) : [];
  const body =
    state.currentTab === submitTab(state)
      ? renderSubmit(state, theme, width)
      : renderChoiceBody(state.choices[state.currentTab], theme, width);
  return [...head, ...body];
}

// ── Overlay ──────────────────────────────────────────────────────────────────

/** Build a `ui.custom` component for a multi-question questionnaire. */
export function createQuestionnaireComponent(
  deps: {
    tui: Pick<TUI, "requestRender">;
    theme: ThemeLike;
    done: (result: QuestionnaireResult) => void;
  },
  questions: Question[],
): Component {
  const state = makeQuestionnaireState(questions);
  let cached: string[] | undefined;
  const refresh = () => {
    cached = undefined;
    deps.tui.requestRender();
  };
  return {
    render: (width: number): string[] => {
      if (cached) return cached;
      cached = renderQuestionnaireBody(state, deps.theme, width);
      return cached;
    },
    handleInput: (data: string): void => {
      const event = handleQuestionnaireKey(state, data);
      if (event.type === "submit") deps.done(event.result);
      else if (event.type === "cancel") deps.done({ answers: [], cancelled: true });
      else if (event.type === "render") refresh();
    },
    invalidate: () => {
      cached = undefined;
    },
  };
}

/** Run a questionnaire as an overlay; resolves with the user's answers. */
export async function askQuestionnaire(
  ui: Ui,
  questions: Question[],
  opts?: { signal?: AbortSignal },
): Promise<QuestionnaireResult> {
  return ui.custom<QuestionnaireResult>((tui, theme, _keybindings, done) => {
    if (opts?.signal?.aborted) done({ answers: [], cancelled: true });
    opts?.signal?.addEventListener("abort", () => done({ answers: [], cancelled: true }), {
      once: true,
    });
    return createQuestionnaireComponent({ tui, theme, done }, questions);
  });
}
