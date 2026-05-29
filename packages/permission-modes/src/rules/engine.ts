import { matchBash, matchPath, rulesForTool, splitCompound } from "./match.ts";
import { type PermissionRuleValue, parseRule } from "./parser.ts";

export type Decision = "allow" | "ask" | "deny";

/** Raw rule strings grouped by behavior, merged from all sources. */
export interface RuleSet {
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface ToolCall {
  toolName: string;
  /** For bash: the raw command (used for display/scope). */
  command?: string;
  /**
   * For bash: command-node texts from the tree-sitter AST. When omitted, the
   * raw `command` is split with the conservative fallback splitter (tests only).
   */
  bashCommands?: string[];
  /** For bash: true if AST analysis failed — fail safe (never auto-allow). */
  bashUnparsed?: boolean;
  /** For edit/write/read. */
  path?: string;
}

function parseAll(raw: string[]): PermissionRuleValue[] {
  const out: PermissionRuleValue[] = [];
  for (const s of raw) {
    const r = parseRule(s);
    if (r) out.push(r);
  }
  return out;
}

function matches(call: ToolCall, rules: PermissionRuleValue[], allowSemantics: boolean): boolean {
  const relevant = rulesForTool(rules, call.toolName);
  if (relevant.length === 0) return false;

  if (call.toolName === "bash") {
    // Fail safe: if AST parsing failed, never auto-allow (a hidden command
    // substitution could bypass an allow rule). Deny/ask still match best-effort.
    if (call.bashUnparsed && allowSemantics) return false;
    const commands = call.bashCommands ?? splitCompound(call.command ?? "");
    return matchBash(commands, relevant, allowSemantics ? "all" : "any");
  }
  if (call.toolName === "edit" || call.toolName === "write" || call.toolName === "read") {
    return matchPath(call.path, relevant);
  }
  // Generic / custom tools: only tool-wide rules (no specifier) apply.
  return relevant.some((r) => r.ruleContent === undefined);
}

/**
 * Resolve a tool call against the merged ruleset.
 * Precedence: deny > ask > allow. Returns undefined when no rule matches.
 */
export function decide(call: ToolCall, rules: RuleSet): Decision | undefined {
  const deny = parseAll(rules.deny);
  if (matches(call, deny, false)) return "deny";

  const ask = parseAll(rules.ask);
  if (matches(call, ask, false)) return "ask";

  const allow = parseAll(rules.allow);
  if (matches(call, allow, true)) return "allow";

  return undefined;
}
