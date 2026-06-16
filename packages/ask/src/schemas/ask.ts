import { Type } from "typebox";

/** One selectable option, mirroring Claude Code's AskUserQuestion option shape. */
const AskOption = Type.Object({
  label: Type.String({
    description: "The concise display text for this option (1-5 words).",
  }),
  description: Type.String({
    description: "A short explanation of what this option means or what choosing it implies.",
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "Optional multi-line preview (code, config, diagram, layout) shown beside the option so the user can compare choices visually. Use for concrete artifacts, not simple preferences.",
    }),
  ),
});

/** One question with 2-4 mutually exclusive options (unless multiSelect). */
const AskQuestion = Type.Object({
  question: Type.String({
    description: "The full question text. Be specific and end with a question mark.",
  }),
  header: Type.String({
    description: "A very short label (max ~12 chars) shown as a chip/tab, e.g. 'Scope', 'Library'.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({
      description:
        "Allow selecting multiple options instead of one. Use when choices are not mutually exclusive.",
    }),
  ),
  options: Type.Array(AskOption, {
    minItems: 2,
    maxItems: 4,
    description: "The available choices (2-4). Each should be distinct.",
  }),
});

/** Parameters for the `ask` tool: 1-4 questions presented to the user. */
export const AskToolInput = Type.Object({
  questions: Type.Array(AskQuestion, {
    minItems: 1,
    maxItems: 4,
    description: "The questions to ask the user (1-4).",
  }),
});

/** A single recorded answer, surfaced for rendering. */
export interface AskAnswer {
  header: string;
  question: string;
  /** Labels of the selected options (length 0..1 unless multiSelect). */
  selectedLabels: string[];
  /** Freeform note the user attached, if any. */
  text?: string;
}

/** Structured details attached to the tool result for rendering. */
export interface AskToolDetails {
  cancelled: boolean;
  answers: AskAnswer[];
}
