import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { promptForTool } from "../src/prompt.ts";

/**
 * Render the real `promptForTool` overlay at a given viewport `width` and return
 * the lines it emits. The fake UI invokes the component's `render(width)` (the
 * pi-tui Component contract) then sends Escape so the overlay's `done` resolves.
 */
async function renderPromptAt(title: string, width: number): Promise<string[]> {
  let lines: string[] = [];
  const ui = {
    custom: async <T>(
      factory: (
        tui: { requestRender: () => void },
        theme: { fg: (c: string, s: string) => string },
        kb: unknown,
        done: (r: T) => void,
      ) => { render: (w: number) => string[]; handleInput: (d: string) => void },
    ): Promise<T> => {
      let resolved: T | undefined;
      const comp = factory({ requestRender: () => {} }, { fg: (_c, s) => s }, {}, (r: T) => {
        resolved = r;
      });
      lines = comp.render(width);
      comp.handleInput("\x1b"); // Escape → deny → resolves done
      return resolved as T;
    },
    notify: () => {},
  } as unknown as Parameters<typeof promptForTool>[0];
  await promptForTool(ui, title);
  return lines;
}

// Mirrors the layout controller.ts builds for a bash approval: a header line, a
// blank, then a 2-space-indented one-line command preview (capped at 200 chars).
const longCommand = "git commit -m " + "x".repeat(250);
const bashTitle = `Approve — run command?\n\n  ${longCommand}`;

describe("promptForTool — width fitting", () => {
  it("never emits a line wider than the viewport (regression: pi-crash on long commands)", async () => {
    const widths = [40, 80, 170, 198];
    const renders = await Promise.all(widths.map((width) => renderPromptAt(bashTitle, width)));
    renders.forEach((lines, i) => {
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(widths[i]);
      }
    });
  });

  it("truncates the long command line with an ellipsis when it overflows", async () => {
    const lines = await renderPromptAt(bashTitle, 80);
    const commandLine = lines.find((l) => l.trimStart().startsWith("git commit"));
    expect(commandLine).toBeDefined();
    expect(commandLine).toContain("…"); // ellipsis marks the truncation
    expect(commandLine).not.toContain("x".repeat(250)); // full command was cut
    expect(visibleWidth(commandLine as string)).toBe(80);
  });

  it("leaves lines untouched when they already fit", async () => {
    const lines = await renderPromptAt(bashTitle, 400);
    const commandLine = lines.find((l) => l.trimStart().startsWith("git commit"));
    expect(commandLine).toBe(`  ${longCommand}`);
  });
});
