import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

export type PromptChoice = "once" | "session" | "always" | "deny";

export interface PromptOutcome {
  choice: PromptChoice;
  /**
   * Optional freeform note typed by the user (Tab on the highlighted option):
   * - on an allow choice: steering text delivered to the model (the tool still runs);
   * - on `deny`: the redirect the model sees as the blocked-tool reason.
   */
  note?: string;
}

interface Option {
  label: string;
  choice: PromptChoice;
}

const OPTIONS: Option[] = [
  { label: "Yes", choice: "once" },
  { label: "Yes, allow for the rest of this session", choice: "session" },
  { label: "Yes, always (save to Pi permissions)", choice: "always" },
  { label: "No", choice: "deny" },
];

/**
 * Approval prompt rendered as a custom overlay (mirrors Claude Code): arrow-key
 * select, and **Tab** on the highlighted option reveals an inline note field
 * (`Yes, ▏`). Type the note and Enter submits choice + note; Esc backs out of
 * the field, or cancels (deny) from the list.
 */
export async function promptForTool(
  ui: ExtensionContext["ui"],
  title: string,
): Promise<PromptOutcome> {
  return ui.custom<PromptOutcome>((tui, theme, _keybindings, done) => {
    let index = 0;
    let noteMode = false;
    let note = "";
    let cached: string[] | undefined;

    const refresh = () => {
      cached = undefined;
      tui.requestRender();
    };

    // Build the prompt's logical lines (title + options + hint). Cached because
    // the content only changes on input; per-render width fitting happens below.
    const build = (): string[] => {
      const lines: string[] = [];
      for (const line of title.split("\n")) lines.push(line);
      lines.push("");
      for (let i = 0; i < OPTIONS.length; i++) {
        const selected = i === index;
        const prefix = selected ? theme.fg("accent", "→ ") : "  ";
        let label = selected ? theme.fg("accent", OPTIONS[i].label) : OPTIONS[i].label;
        if (selected && noteMode) {
          label += `${theme.fg("accent", ", ")}${note}${theme.fg("accent", "▏")}`;
        }
        lines.push(`${prefix}${label}`);
      }
      lines.push("");
      lines.push(
        theme.fg(
          "muted",
          noteMode
            ? "type note · enter submit · esc back"
            : "↑↓ navigate · enter select · tab add note · esc cancel",
        ),
      );
      return lines;
    };

    // `width` is the live viewport width (Component contract). Every emitted line
    // MUST fit it: pi-tui's renderer throws an uncaught exception — crashing pi —
    // if any visible line exceeds the terminal width. The title can carry a long
    // one-line command preview, so fit each line to the current width.
    const render = (width: number): string[] => {
      cached ??= build();
      return cached.map((line) => truncateToWidth(line, width, "…"));
    };

    const handleInput = (data: string): void => {
      if (noteMode) {
        if (matchesKey(data, Key.enter)) {
          done({ choice: OPTIONS[index].choice, note: note.trim() || undefined });
        } else if (matchesKey(data, Key.escape)) {
          noteMode = false;
          note = "";
          refresh();
        } else if (matchesKey(data, Key.backspace)) {
          note = note.slice(0, -1);
          refresh();
        } else if (isPrintable(data)) {
          note += data;
          refresh();
        }
        return;
      }
      if (matchesKey(data, Key.up)) {
        index = Math.max(0, index - 1);
        refresh();
      } else if (matchesKey(data, Key.down)) {
        index = Math.min(OPTIONS.length - 1, index + 1);
        refresh();
      } else if (matchesKey(data, Key.tab)) {
        noteMode = true;
        note = "";
        refresh();
      } else if (matchesKey(data, Key.enter)) {
        done({ choice: OPTIONS[index].choice });
      } else if (matchesKey(data, Key.escape)) {
        done({ choice: "deny" });
      }
    };

    return {
      render,
      handleInput,
      invalidate: () => {
        cached = undefined;
      },
    };
  });
}

/** Printable text (incl. pasted runs); excludes control/escape sequences. */
function isPrintable(data: string): boolean {
  return data.length > 0 && !data.startsWith("\x1b") && [...data].every((c) => c >= " ");
}
