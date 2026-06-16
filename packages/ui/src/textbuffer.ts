/**
 * Minimal single-line text buffer with a cursor. Self-contained (no pi-tui
 * `Editor` dependency) so the choice overlay stays decoupled and unit tests can
 * drive it with raw keystrokes through a stub `tui`/`theme`.
 */
export class TextBuffer {
  private chars: string[] = [];
  private caret = 0;

  get value(): string {
    return this.chars.join("");
  }

  set value(text: string) {
    this.chars = [...text];
    this.caret = this.chars.length;
  }

  get cursor(): number {
    return this.caret;
  }

  clear(): void {
    this.chars = [];
    this.caret = 0;
  }

  /** Insert a run of printable text at the caret. */
  insert(text: string): void {
    const runes = [...text];
    this.chars.splice(this.caret, 0, ...runes);
    this.caret += runes.length;
  }

  /** Delete the grapheme before the caret (Backspace). */
  backspace(): void {
    if (this.caret > 0) {
      this.chars.splice(this.caret - 1, 1);
      this.caret -= 1;
    }
  }

  /** Delete the grapheme at the caret (Delete). */
  deleteForward(): void {
    if (this.caret < this.chars.length) {
      this.chars.splice(this.caret, 1);
    }
  }

  left(): void {
    if (this.caret > 0) this.caret -= 1;
  }

  right(): void {
    if (this.caret < this.chars.length) this.caret += 1;
  }

  home(): void {
    this.caret = 0;
  }

  end(): void {
    this.caret = this.chars.length;
  }

  /**
   * Render the buffer with a visible caret marker inserted at the cursor
   * position. `cursor` defaults to a thin bar; pass a styled string to colour it.
   */
  render(cursor = "▏"): string {
    const before = this.chars.slice(0, this.caret).join("");
    const after = this.chars.slice(this.caret).join("");
    return `${before}${cursor}${after}`;
  }
}

/** Printable text (incl. pasted runs); excludes control/escape sequences. */
export function isPrintable(data: string): boolean {
  return (
    data.length > 0 && !data.startsWith("\x1b") && [...data].every((c) => c >= " " && c !== "\x7f")
  );
}
