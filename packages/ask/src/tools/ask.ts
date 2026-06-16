import {
  defineTool,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { askQuestionnaire, type Question } from "@pi-ext/ui";
import type { Static } from "typebox";
import { type AskAnswer, type AskToolDetails, AskToolInput } from "../schemas/ask.ts";

type AskParams = Static<typeof AskToolInput>;

/** Map the tool's question params into `@pi-ext/ui` Question specs. */
function toQuestions(params: AskParams): Question[] {
  return params.questions.map((q, qi) => ({
    id: `q${qi}`,
    header: q.header,
    title: q.question,
    options: q.options.map((o, oi) => ({
      id: `o${oi}`,
      label: o.label,
      description: o.description,
      preview: o.preview,
    })),
    // Matches Claude Code's "press n to add notes" affordance; Tab is left free
    // for moving between question tabs in the multi-question view.
    freeText: { mode: "note", trigger: "n", placement: "footer" } as const,
    multiSelect: q.multiSelect,
  }));
}

/** Render the answers as text the model can act on. */
function summarize(answers: AskAnswer[]): string {
  return answers
    .map((a) => {
      const picked = a.selectedLabels.length ? a.selectedLabels.join(", ") : "(no option selected)";
      const note = a.text ? ` — note: ${a.text}` : "";
      return `${a.header}: ${picked}${note}`;
    })
    .join("\n");
}

const NO_UI_MESSAGE =
  "Cannot ask the user: no interactive UI is attached. Proceed with your best judgement, or state the assumptions you are making.";

export function makeAskTool(): ToolDefinition<typeof AskToolInput, AskToolDetails> {
  return defineTool<typeof AskToolInput, AskToolDetails>({
    name: "ask",
    label: "Ask",
    description: `Ask the user one or more multiple-choice questions and get their selections back.

Use this to resolve genuine ambiguity, confirm a direction before significant work, or choose between viable approaches — instead of guessing. Each question shows 2-4 options; the user can select an option (or several, with multiSelect), attach a freeform note, or dismiss to keep discussing.`,
    promptSnippet: "Ask the user multiple-choice questions to clarify requirements.",
    promptGuidelines: [
      "Use `ask` when the request is ambiguous or has multiple reasonable interpretations — don't guess.",
      "Ask 1-4 focused questions at once, each with 2-4 concrete options and short descriptions.",
      "Use an option's `preview` to show code/config/layout the user should compare side by side.",
      "Do not ask about things you can determine yourself from the codebase or context.",
    ],
    parameters: AskToolInput,

    async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
      if (!ctx.hasUI) {
        return {
          content: [{ type: "text", text: NO_UI_MESSAGE }],
          details: { cancelled: true, answers: [] },
          isError: true,
        };
      }

      const questions = toQuestions(params);
      const result = await askQuestionnaire(ctx.ui, questions, { signal });

      if (result.cancelled) {
        return {
          content: [
            {
              type: "text",
              text: "The user dismissed the question(s) without answering. They likely want to discuss further rather than pick from the given options.",
            },
          ],
          details: { cancelled: true, answers: [] },
        };
      }

      const answers: AskAnswer[] = questions.map((q) => {
        const a = result.answers.find((x) => x.id === q.id);
        const selectedLabels = (a?.selected ?? []).map(
          (id) => q.options.find((o) => o.id === id)?.label ?? id,
        );
        return { header: q.header, question: q.title, selectedLabels, text: a?.text };
      });

      return {
        content: [{ type: "text", text: summarize(answers) }],
        details: { cancelled: false, answers },
      };
    },

    renderCall(args, theme) {
      const count = args.questions.length;
      const headers = args.questions.map((q) => q.header).join(", ");
      const title = theme.fg("toolTitle", theme.bold("ask"));
      const meta = theme.fg("muted", ` ${count} question${count === 1 ? "" : "s"}`);
      const detail = headers ? theme.fg("dim", ` (${headers})`) : "";
      return new Text(`${title}${meta}${detail}`, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details;
      if (!details || details.cancelled) {
        return new Text(theme.fg("warning", "Dismissed"), 0, 0);
      }
      const lines = details.answers.map((a) => {
        const picked = a.selectedLabels.length ? a.selectedLabels.join(", ") : "—";
        const note = a.text ? theme.fg("muted", ` — ${a.text}`) : "";
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.header)}: ${picked}${note}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
