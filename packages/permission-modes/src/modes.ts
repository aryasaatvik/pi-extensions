import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Permission modes, mirroring Claude Code. Cycled with Shift+Tab.
 *
 * - `default`: read-only tools run freely; mutating tools (bash/edit/write) are
 *   evaluated against the rule engine and prompt when no allow rule matches.
 * - `acceptEdits`: file edits (edit/write) auto-apply; bash still goes through
 *   the rule engine (so `git commit` still prompts unless allowlisted).
 * - `plan`: all mutating tools are blocked.
 * - `bypass`: everything runs, no prompts, rules skipped.
 */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypass";

/** Cycle order for Shift+Tab. Wraps back to the start. */
export const MODE_CYCLE: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypass"];

export function nextMode(mode: PermissionMode): PermissionMode {
  const i = MODE_CYCLE.indexOf(mode);
  return MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
}

export function isPermissionMode(value: string): value is PermissionMode {
  return (MODE_CYCLE as readonly string[]).includes(value);
}

export interface ModeDisplay {
  label: string;
  symbol: string;
  color: ThemeColor;
}

const DISPLAY: Record<PermissionMode, ModeDisplay> = {
  default: { label: "default", symbol: "●", color: "muted" },
  acceptEdits: { label: "accept edits", symbol: "✓", color: "success" },
  plan: { label: "plan", symbol: "⏸", color: "warning" },
  bypass: { label: "bypass", symbol: "⚠", color: "error" },
};

export function modeDisplay(mode: PermissionMode): ModeDisplay {
  return DISPLAY[mode];
}

/** Tools that never mutate state — always allowed (subject only to explicit deny rules). */
export const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

/** Tools that mutate the workspace and are gated by mode + rules. */
export const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);
