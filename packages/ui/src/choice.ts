import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { clip, renderBox, type ThemeLike, wrap, zipColumns } from "./layout.ts";
import { isPrintable, TextBuffer } from "./textbuffer.ts";
import type { ChoiceOption, ChoiceResult, ChoiceSpec } from "./types.ts";

type Ui = ExtensionContext["ui"];

/** Synthetic option id for the "Type something" entry (freeText `other` mode). */
export const OTHER_ID = "__other__";

/** Minimum total width before the preview is shown beside (vs. below) the list. */
const SPLIT_MIN_WIDTH = 64;

/** Live state for one choice question. Mutated in place by {@link handleChoiceKey}. */
export interface ChoiceState {
  readonly spec: ChoiceSpec;
  /** spec.options plus a synthetic "other" entry when freeText is `other`. */
  readonly options: ChoiceOption[];
  /** Index of the focused option. */
  index: number;
  /** Chosen ids (only grows beyond one when `multiSelect`). */
  readonly selected: Set<string>;
  /** `list` = navigating; `text` = typing a note or an "other" answer. */
  mode: "list" | "text";
  /** Which kind of text is being edited (null in list mode). */
  textKind: "note" | "other" | null;
  /** Backing buffer for the active text field. */
  readonly buffer: TextBuffer;
}

/** What a keystroke did, so a host (overlay or questionnaire) can react. */
export type ChoiceEvent =
  | { type: "none" }
  | { type: "render" }
  | { type: "submit"; result: ChoiceResult }
  | { type: "cancel" };

export function makeChoiceState(spec: ChoiceSpec): ChoiceState {
  const options = [...spec.options];
  if (spec.freeText?.mode === "other") {
    options.push({ id: OTHER_ID, label: spec.freeText.label ?? "Type something." });
  }
  return {
    spec,
    options,
    index: 0,
    selected: new Set<string>(),
    mode: "list",
    textKind: null,
    buffer: new TextBuffer(),
  };
}

function noteTriggerKey(spec: ChoiceSpec): "tab" | "n" | null {
  return spec.freeText?.mode === "note" ? (spec.freeText.trigger ?? "tab") : null;
}

function selectionResult(state: ChoiceState, text?: string): ChoiceResult {
  const selected = state.spec.multiSelect
    ? [...state.selected]
    : [state.options[state.index]?.id].filter((id): id is string => id != null && id !== OTHER_ID);
  return { selected, text: text || undefined, cancelled: false };
}

/** Apply a keystroke to `state`. Returns what the host should do next. */
export function handleChoiceKey(state: ChoiceState, data: string): ChoiceEvent {
  if (state.mode === "text") return handleTextKey(state, data);

  if (matchesKey(data, Key.up)) {
    state.index = Math.max(0, state.index - 1);
    return { type: "render" };
  }
  if (matchesKey(data, Key.down)) {
    state.index = Math.min(state.options.length - 1, state.index + 1);
    return { type: "render" };
  }

  // Space toggles in multiSelect (never toggles the synthetic "other" entry).
  if (state.spec.multiSelect && data === " ") {
    const opt = state.options[state.index];
    if (opt && opt.id !== OTHER_ID) {
      if (state.selected.has(opt.id)) state.selected.delete(opt.id);
      else state.selected.add(opt.id);
    }
    return { type: "render" };
  }

  // Open the note editor on its configured trigger.
  const trigger = noteTriggerKey(state.spec);
  if (trigger === "tab" && matchesKey(data, Key.tab)) return enterText(state, "note");
  if (trigger === "n" && data === "n") return enterText(state, "note");

  if (matchesKey(data, Key.enter)) {
    const opt = state.options[state.index];
    if (opt?.id === OTHER_ID) return enterText(state, "other");
    if (state.spec.multiSelect) {
      return { type: "submit", result: { selected: [...state.selected], cancelled: false } };
    }
    return { type: "submit", result: selectionResult(state) };
  }

  if (matchesKey(data, Key.escape)) return { type: "cancel" };
  return { type: "none" };
}

function enterText(state: ChoiceState, kind: "note" | "other"): ChoiceEvent {
  state.mode = "text";
  state.textKind = kind;
  state.buffer.clear();
  return { type: "render" };
}

function exitText(state: ChoiceState): ChoiceEvent {
  state.mode = "list";
  state.textKind = null;
  state.buffer.clear();
  return { type: "render" };
}

function handleTextKey(state: ChoiceState, data: string): ChoiceEvent {
  if (matchesKey(data, Key.enter)) {
    const text = state.buffer.value.trim();
    if (state.textKind === "other") {
      if (!text) return exitText(state); // empty answer → back to the list
      return { type: "submit", result: { selected: [], text, cancelled: false } };
    }
    // note: the selection stands; the note rides along.
    const result = selectionResult(state, text);
    return { type: "submit", result };
  }
  if (matchesKey(data, Key.escape)) return exitText(state);
  if (matchesKey(data, Key.backspace)) {
    state.buffer.backspace();
    return { type: "render" };
  }
  if (matchesKey(data, Key.left)) {
    state.buffer.left();
    return { type: "render" };
  }
  if (matchesKey(data, Key.right)) {
    state.buffer.right();
    return { type: "render" };
  }
  if (isPrintable(data)) {
    state.buffer.insert(data);
    return { type: "render" };
  }
  return { type: "none" };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Render the options list (title + options), without the footer. */
export function renderOptionsBlock(state: ChoiceState, theme: ThemeLike, width: number): string[] {
  const lines: string[] = [];
  for (const line of state.spec.title.split("\n")) lines.push(clip(theme.fg("text", line), width));
  lines.push("");

  const inlineNote =
    state.mode === "text" &&
    state.textKind === "note" &&
    (state.spec.freeText?.mode === "note"
      ? (state.spec.freeText.placement ?? "inline")
      : "inline") === "inline";

  for (let i = 0; i < state.options.length; i++) {
    const opt = state.options[i];
    const focused = i === state.index;
    const marker =
      state.spec.multiSelect && opt.id !== OTHER_ID
        ? state.selected.has(opt.id)
          ? "◉ "
          : "○ "
        : "";
    const prefix = focused ? theme.fg("accent", "→ ") : "  ";
    let label = `${marker}${i + 1}. ${opt.label}`;
    label = focused ? theme.fg("accent", label) : theme.fg("text", label);
    if (focused && inlineNote) {
      label += `${theme.fg("accent", ", ")}${state.buffer.render(theme.fg("accent", "▏"))}`;
    }
    lines.push(clip(`${prefix}${label}`, width));
    if (opt.description) lines.push(clip(`     ${theme.fg("muted", opt.description)}`, width));
  }
  return lines;
}

function renderFooter(state: ChoiceState, theme: ThemeLike, width: number): string[] {
  const lines: string[] = [""];
  const ft = state.spec.freeText;
  const editingOther = state.mode === "text" && state.textKind === "other";
  const noteFooter = ft?.mode === "note" && (ft.placement ?? "inline") === "footer";

  if (editingOther) {
    lines.push(
      clip(
        `${theme.fg("muted", "Your answer: ")}${state.buffer.render(theme.fg("accent", "▏"))}`,
        width,
      ),
    );
    lines.push(clip(theme.fg("dim", "enter submit · esc back"), width));
    return lines;
  }

  if (noteFooter) {
    if (state.mode === "text" && state.textKind === "note") {
      lines.push(
        clip(
          `${theme.fg("muted", "Notes: ")}${state.buffer.render(theme.fg("accent", "▏"))}`,
          width,
        ),
      );
      lines.push(clip(theme.fg("dim", "enter submit · esc back"), width));
    } else {
      const key = ft.trigger === "n" ? "n" : "tab";
      lines.push(clip(theme.fg("muted", `Notes: press ${key} to add notes`), width));
      lines.push(clip(theme.fg("dim", hint(state)), width));
    }
    return lines;
  }

  if (state.mode === "text" && state.textKind === "note") {
    lines.push(clip(theme.fg("dim", "type note · enter submit · esc back"), width));
    return lines;
  }
  lines.push(clip(theme.fg("dim", hint(state)), width));
  return lines;
}

function hint(state: ChoiceState): string {
  const parts = ["↑↓ navigate"];
  if (state.spec.multiSelect) parts.push("space toggle", "enter confirm");
  else parts.push("enter select");
  const trigger = noteTriggerKey(state.spec);
  if (trigger === "tab") parts.push("tab note");
  else if (trigger === "n") parts.push("n note");
  parts.push("esc cancel");
  return parts.join(" · ");
}

/** Render the full body (options + focus-driven preview + footer) for `width`. */
export function renderChoiceBody(state: ChoiceState, theme: ThemeLike, width: number): string[] {
  const preview = state.options[state.index]?.preview;
  const optionsWidth =
    preview && width >= SPLIT_MIN_WIDTH ? Math.max(28, Math.floor(width * 0.45)) : width;
  const optionsBlock = renderOptionsBlock(state, theme, optionsWidth);

  let body: string[];
  if (preview && width >= SPLIT_MIN_WIDTH) {
    const rightWidth = width - optionsWidth - 2; // 2 = column separator
    const box = renderBox(
      theme,
      wrap(theme.fg("toolOutput", preview), rightWidth - 4),
      rightWidth - 4,
    );
    body = zipColumns(optionsBlock, box, optionsWidth);
  } else if (preview) {
    // Too narrow for columns: stack the preview below the list.
    body = [
      ...optionsBlock,
      "",
      ...renderBox(theme, wrap(theme.fg("toolOutput", preview), width - 4), width - 4),
    ];
  } else {
    body = optionsBlock;
  }
  return [...body, ...renderFooter(state, theme, width)];
}

// ── Standalone overlay ───────────────────────────────────────────────────────

/** Build a `ui.custom` component for a single choice question. */
export function createChoiceComponent(
  deps: { tui: Pick<TUI, "requestRender">; theme: ThemeLike; done: (result: ChoiceResult) => void },
  spec: ChoiceSpec,
): Component {
  const state = makeChoiceState(spec);
  let cached: string[] | undefined;

  const refresh = () => {
    cached = undefined;
    deps.tui.requestRender();
  };

  return {
    render: (width: number): string[] => {
      if (cached) return cached;
      cached = renderChoiceBody(state, deps.theme, width);
      return cached;
    },
    handleInput: (data: string): void => {
      const event = handleChoiceKey(state, data);
      if (event.type === "submit") deps.done(event.result);
      else if (event.type === "cancel") deps.done({ selected: [], cancelled: true });
      else if (event.type === "render") refresh();
    },
    invalidate: () => {
      cached = undefined;
    },
  };
}

/** Run a single choice question as an overlay; resolves with the user's result. */
export async function askChoice(
  ui: Ui,
  spec: ChoiceSpec,
  opts?: { signal?: AbortSignal },
): Promise<ChoiceResult> {
  return ui.custom<ChoiceResult>((tui, theme, _keybindings, done) => {
    if (opts?.signal?.aborted) done({ selected: [], cancelled: true });
    opts?.signal?.addEventListener("abort", () => done({ selected: [], cancelled: true }), {
      once: true,
    });
    return createChoiceComponent({ tui, theme, done }, spec);
  });
}
