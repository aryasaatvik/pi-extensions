import type { RuleSet } from "./engine.ts";

/**
 * Pure helpers for reading permission rules out of arbitrary JSON objects and
 * merging rule sets. Kept free of Node/Pi imports so they are trivially testable.
 */

export function toStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
}

export function emptyRuleSet(): RuleSet {
  return { allow: [], deny: [], ask: [] };
}

/**
 * Extract a rule set from a parsed JSON object, accepting two shapes:
 * - settings-style (Claude / Pi settings.json): rules under `.permissions`
 * - dedicated store (our permissions.json): rules at the top level
 */
export function extractPermissions(obj: unknown): RuleSet {
  if (!obj || typeof obj !== "object") return emptyRuleSet();
  const record = obj as Record<string, unknown>;
  const nested = record.permissions;
  const src = (nested && typeof nested === "object" ? nested : record) as Record<string, unknown>;
  return {
    allow: toStringArray(src.allow),
    deny: toStringArray(src.deny),
    ask: toStringArray(src.ask),
  };
}

/** Concatenate and dedupe several rule sets into one. */
export function mergeRuleSets(sets: RuleSet[]): RuleSet {
  const out = emptyRuleSet();
  for (const s of sets) {
    out.allow.push(...s.allow);
    out.deny.push(...s.deny);
    out.ask.push(...s.ask);
  }
  out.allow = [...new Set(out.allow)];
  out.deny = [...new Set(out.deny)];
  out.ask = [...new Set(out.ask)];
  return out;
}
