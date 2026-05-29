import { dirname } from "node:path";
import { normalizeSubcommand, splitCompound } from "./rules/match.ts";

/** Commands whose meaningful verb is two tokens (e.g. `git commit`, `npm run`). */
const MULTI_WORD = new Set([
  "git",
  "git-hunk",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "cargo",
  "docker",
  "kubectl",
  "go",
  "pip",
  "poetry",
  "brew",
  "gh",
  "make",
]);

/** Derive an allow rule scoped to a bash command's verb, e.g. `git commit ...` -> `Bash(git commit:*)`. */
export function bashScopeRule(command: string): string {
  const first = splitCompound(command)[0] ?? command;
  const sub = normalizeSubcommand(first) || first.trim();
  const tokens = sub.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "Bash";
  const prefix = MULTI_WORD.has(tokens[0]) && tokens[1] ? `${tokens[0]} ${tokens[1]}` : tokens[0];
  return `Bash(${prefix}:*)`;
}

/** Derive an allow rule scoped to an edit/write target's directory, e.g. `Edit(src/**)`. */
export function pathScopeRule(toolName: string, path: string | undefined): string {
  const tool = toolName === "write" ? "Write" : "Edit";
  if (!path) return tool;
  return `${tool}(${dirname(path)}/**)`;
}
