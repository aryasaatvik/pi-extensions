import { type PermissionRuleValue, type ShellRule, parseShellRule } from "./parser.ts";

/**
 * Matching logic for permission rules against a concrete tool call.
 *
 * - Tool names are compared case-insensitively (`Bash` rule vs Pi's `bash` tool).
 * - Bash is decomposed into individual command nodes upstream (tree-sitter AST,
 *   see bash-ast.ts), so command substitution / pipelines / subshells each become
 *   their own command. The matcher receives that list.
 * - For "allow" semantics, EVERY (non-benign) command must match an allow rule.
 *   For "deny"/"ask" semantics, ANY matching command is enough.
 */

const SAFE_WRAPPERS = new Set(["timeout", "time", "nice", "nohup", "stdbuf", "command", "builtin"]);

/**
 * Harmless no-op commands that agents routinely chain (e.g. `cd <repo> && …`).
 * Skipped only when checking whether *every* command is allowed, so a benign
 * prefix can't defeat an allow rule. They are still seen by deny/ask matching.
 */
const BENIGN_NOOP = new Set(["cd", "pwd", "true", ":"]);

function isBenignNoop(normalized: string): boolean {
  return BENIGN_NOOP.has(normalized.split(/\s+/)[0] ?? "");
}

function sameTool(ruleTool: string, toolName: string): boolean {
  return ruleTool.toLowerCase() === toolName.toLowerCase();
}

/** Split a shell command on top-level compound operators: && || | ; & and newlines. */
export function splitCompound(command: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      parts.push(buf);
      buf = "";
      i++;
      continue;
    }
    if (c === "|" || c === ";" || c === "&" || c === "\n") {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*$/;

/** Strip leading env assignments, safe wrappers, and trailing output redirections. */
export function normalizeSubcommand(sub: string): string {
  // Drop output redirections (`> file`, `>> file`, `2> file`, `&> file`).
  let cmd = sub.replace(/\s*\d*&?>>?\s*\S+/g, "").trim();
  const tokens = cmd.split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (ENV_ASSIGNMENT.test(t)) {
      i++;
      continue;
    }
    if (SAFE_WRAPPERS.has(t)) {
      i++;
      // skip wrapper flags like `timeout -s KILL 5`
      while (i < tokens.length && tokens[i].startsWith("-")) i++;
      if (t === "timeout" && i < tokens.length && /^\d/.test(tokens[i])) i++;
      continue;
    }
    break;
  }
  cmd = tokens.slice(i).join(" ");
  return cmd.trim();
}

function matchShellRule(rule: ShellRule, cmd: string): boolean {
  switch (rule.type) {
    case "exact":
      return cmd === rule.command;
    case "prefix":
      return cmd === rule.prefix || cmd.startsWith(`${rule.prefix} `);
    case "wildcard":
      return globToRegExp(rule.pattern).test(cmd);
  }
}

/** Convert a glob (`*` = any non-slash run, `**` = any run) to a RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
      continue;
    }
    re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  re += "$";
  return new RegExp(re);
}

export type MatchSemantics = "any" | "all";

/**
 * Does a set of decomposed Bash commands match the given Bash rules?
 * @param commands command-node texts (from the AST; or splitCompound output as fallback)
 * @param semantics "all" for allow (every non-benign command must match); "any" for deny/ask.
 */
export function matchBash(
  commands: string[],
  rules: PermissionRuleValue[],
  semantics: MatchSemantics,
): boolean {
  const shellRules: ShellRule[] = [];
  let toolWide = false;
  for (const r of rules) {
    if (r.ruleContent === undefined) {
      toolWide = true; // bare `Bash` rule matches every command
    } else {
      shellRules.push(parseShellRule(r.ruleContent));
    }
  }
  if (toolWide) return true;
  if (shellRules.length === 0) return false;

  const subs = commands.map(normalizeSubcommand).filter(Boolean);
  if (subs.length === 0) return false;

  const matchesSub = (sub: string) => shellRules.some((sr) => matchShellRule(sr, sub));

  if (semantics === "any") return subs.some(matchesSub);

  // "all": ignore benign no-ops, then require every remaining command to match.
  const meaningful = subs.filter((s) => !isBenignNoop(s));
  if (meaningful.length === 0) return true; // e.g. just `cd /repo`
  return meaningful.every(matchesSub);
}

/** Match a path-bearing tool (edit/write/read) against its rules. */
export function matchPath(path: string | undefined, rules: PermissionRuleValue[]): boolean {
  for (const r of rules) {
    if (r.ruleContent === undefined) return true; // bare `Edit`/`Write` matches any path
    if (path && globToRegExp(r.ruleContent).test(path)) return true;
  }
  return false;
}

/** Filter parsed rules down to those targeting a given Pi tool name. */
export function rulesForTool(
  rules: PermissionRuleValue[],
  toolName: string,
): PermissionRuleValue[] {
  return rules.filter((r) => sameTool(r.toolName, toolName));
}
