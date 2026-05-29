import { readFileSync } from "node:fs";
import { type Skill, parseFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * Pi has no skill lifecycle — skills are text-expanded (`/skill:name` becomes a
 * `<skill>…</skill>` block) and `allowed-tools` is parsed but not enforced. This
 * tracker reconstructs an "active skill" from the input stream so the skill's
 * `allowed-tools` can act as allow rules while it is in scope.
 *
 * Scope: activated on `/skill:` input, cleared on the next plain user message.
 *
 * Limitation: model-invoked skills (not typed `/skill:` by the user) do not emit
 * an `input` event and therefore are not detected.
 */
export class SkillTracker {
  private byName = new Map<string, string>();
  private pending: string | null = null;
  private activeAllow: string[] = [];
  private activeName: string | null = null;

  /** Cache the loaded skills (name -> SKILL.md path). Called from before_agent_start. */
  cacheSkills(skills: readonly Skill[] | undefined): void {
    if (!skills) return;
    for (const s of skills) this.byName.set(s.name, s.filePath);
  }

  /** Observe user input; updates pending/active scope. */
  onInput(text: string): void {
    const t = text.trimStart();
    if (t.startsWith("/skill:")) {
      const name = t.slice("/skill:".length).split(/\s+/)[0];
      if (name) this.pending = name;
      return;
    }
    // Other slash commands don't change scope.
    if (t.startsWith("/") || t.length === 0) return;
    // Plain user message ends the skill scope.
    this.clear();
  }

  /** Resolve a pending `/skill:` activation. Call after cacheSkills (before_agent_start). */
  resolvePending(): void {
    if (!this.pending) return;
    const name = this.pending;
    this.pending = null;
    const filePath = this.byName.get(name);
    if (!filePath) return;
    this.activeAllow = readSkillAllowedTools(filePath);
    this.activeName = this.activeAllow.length > 0 ? name : null;
  }

  getActiveAllow(): string[] {
    return this.activeAllow;
  }

  getActiveName(): string | null {
    return this.activeName;
  }

  clear(): void {
    this.activeAllow = [];
    this.activeName = null;
    this.pending = null;
  }
}

/** Read a skill's `allowed-tools` frontmatter as a list of rule strings. */
export function readSkillAllowedTools(filePath: string): string[] {
  try {
    const { frontmatter } = parseFrontmatter(readFileSync(filePath, "utf8"));
    return parseAllowedTools(frontmatter["allowed-tools"]);
  } catch {
    return [];
  }
}

/** Parse the `allowed-tools` value (string or array) into rule strings. */
export function parseAllowedTools(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  if (typeof raw === "string") return splitTopLevelCommas(raw);
  return [];
}

/** Split on commas that are not inside parentheses (so `Bash(a,b)` stays intact). */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (const c of s) {
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out.map((x) => x.trim()).filter(Boolean);
}
