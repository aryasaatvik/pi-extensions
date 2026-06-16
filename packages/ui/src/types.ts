/**
 * Shared types for the reusable choice overlay.
 *
 * The overlay is one primitive used in two directions:
 * - host-initiated approval prompts (`@pi-ext/permission-modes`), and
 * - model-initiated questions (`@pi-ext/ask`, mirroring Claude Code's
 *   AskUserQuestion).
 *
 * Both render an option list with optional free-text and an optional
 * side-by-side preview; behaviour is selected via {@link ChoiceSpec}.
 */

/** A single selectable option. */
export interface ChoiceOption {
  /** Stable identifier returned in {@link ChoiceResult.selected}. */
  id: string;
  /** Display label (may include suffixes like `(Recommended)`). */
  label: string;
  /** Optional one-line description shown beneath the label. */
  description?: string;
  /**
   * Optional multi-line preview (code/config/diff). When the focused option has
   * a preview, the overlay splits into two columns: list left, preview right.
   */
  preview?: string;
}

/**
 * Free-text affordance attached to a choice overlay.
 *
 * - `note`: annotate the chosen action with a freeform note. `trigger` is the
 *   key that opens the editor (`tab` annotates the highlighted option inline;
 *   `n` opens a footer "Notes:" editor, matching Claude Code). The note is
 *   returned alongside the selection — the selection still stands. In a
 *   multi-question questionnaire `tab` (the default) is reserved for moving
 *   between questions, so the shell falls a note's trigger back to `n` there.
 * - `other`: add a synthetic "Type something" option that, when chosen, opens
 *   an editor; the typed text becomes the answer (no option id).
 */
export type FreeText =
  | { mode: "note"; trigger?: "tab" | "n"; placement?: "inline" | "footer" }
  | { mode: "other"; label?: string }
  | undefined;

/** Specification for a single-question choice overlay. */
export interface ChoiceSpec {
  /** Question/prompt text shown above the options (may be multi-line). */
  title: string;
  /** Short contextual chip/label (e.g. for a tab bar). */
  header?: string;
  /** The selectable options. */
  options: ChoiceOption[];
  /** Free-text behaviour; omit for a plain pick. */
  freeText?: FreeText;
  /** When true, Space toggles multiple options and Enter confirms. */
  multiSelect?: boolean;
}

/** Result of running a single-question choice overlay. */
export interface ChoiceResult {
  /** Selected option ids (length 0..1 unless `multiSelect`). */
  selected: string[];
  /**
   * Free text: the note (`freeText:"note"`) or the typed answer
   * (`freeText:"other"` when "Type something" was chosen).
   */
  text?: string;
  /** True when the user backed out (Esc) without choosing. */
  cancelled: boolean;
}

/** One question in a multi-question questionnaire. */
export interface Question {
  /** Stable identifier for this question. */
  id: string;
  /** Short tab-bar label (e.g. "Scope", "Approach"). */
  header: string;
  /** Full question text. */
  title: string;
  /** The selectable options. */
  options: ChoiceOption[];
  /** Free-text behaviour for this question. */
  freeText?: FreeText;
  /** When true, Space toggles multiple options and Enter confirms. */
  multiSelect?: boolean;
}

/** A user's answer to one {@link Question}. */
export interface Answer {
  /** The {@link Question.id} this answers. */
  id: string;
  /** Selected option ids (length 0..1 unless the question is multiSelect). */
  selected: string[];
  /** Free text (note, or typed "other" answer), if any. */
  text?: string;
}

/** Result of running a multi-question questionnaire. */
export interface QuestionnaireResult {
  /** Answers keyed positionally to the questions asked. */
  answers: Answer[];
  /** True when the user backed out without submitting. */
  cancelled: boolean;
}
