import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** Minimal theming surface used by the layout helpers (subset of pi-tui `Theme`). */
export interface ThemeLike {
  fg(color: string, text: string): string;
}

/** Pad a (possibly ANSI-coloured) line to exactly `width` visible columns. */
export function padToWidth(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w >= width) return line;
  return line + " ".repeat(width - w);
}

/**
 * Draw a bordered box around `content`, sized to `innerWidth` content columns.
 * Optional `title` is inlined into the top border (`┌─ title ─…┐`).
 */
export function renderBox(
  theme: ThemeLike,
  content: string[],
  innerWidth: number,
  title?: string,
): string[] {
  const inner = Math.max(1, innerWidth);
  const border = (s: string) => theme.fg("border", s);
  const top = title
    ? `┌─ ${title} ${"─".repeat(Math.max(0, inner - visibleWidth(title) - 1))}┐`
    : `┌${"─".repeat(inner + 2)}┐`;
  const bottom = `└${"─".repeat(inner + 2)}┘`;
  const lines = [border(top)];
  for (const raw of content.length > 0 ? content : [""]) {
    lines.push(`${border("│")} ${padToWidth(raw, inner)} ${border("│")}`);
  }
  lines.push(border(bottom));
  return lines;
}

/**
 * Join two columns side by side. The left column is padded to `leftWidth`; the
 * right column is appended after a separator. Shorter columns are padded with
 * blank lines so the result is rectangular.
 */
export function zipColumns(
  left: string[],
  right: string[],
  leftWidth: number,
  separator = "  ",
): string[] {
  const rows = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = padToWidth(left[i] ?? "", leftWidth);
    const r = right[i] ?? "";
    out.push(r ? `${l}${separator}${r}` : l);
  }
  return out;
}

/** Wrap `text` to `width` columns, preserving ANSI; tolerates empty input. */
export function wrap(text: string, width: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    for (const w of wrapTextWithAnsi(para, Math.max(1, width))) lines.push(w);
  }
  return lines;
}

/** Truncate a single line to `width` visible columns with an ellipsis. */
export function clip(text: string, width: number): string {
  return truncateToWidth(text, Math.max(1, width));
}
