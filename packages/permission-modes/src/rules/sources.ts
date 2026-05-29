import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { RuleSet } from "./engine.ts";
import { extractPermissions, mergeRuleSets, toStringArray } from "./merge.ts";

/**
 * Rule sources, two kinds:
 *
 * - Claude settings files (read live, the reuse bridge): `~/.claude/settings.json`,
 *   `<repo>/.claude/settings.json`, `<repo>/.claude/settings.local.json`.
 * - Dedicated Pi-native stores owned by this extension (Pi never parses these):
 *     global  = `<agentDir>/permissions.json`  (~/.pi/agent/permissions.json)
 *     project = `<repo>/.pi/permissions.json`
 *
 * "Allow always" writes to the project store when in a git repo, else the global
 * store. The one-time Claude import seeds the global store and can be opted out.
 */

interface StoreMeta {
  importedFromClaude?: boolean;
  autoImport?: boolean;
}

interface DedicatedStore {
  allow?: string[];
  deny?: string[];
  ask?: string[];
  meta?: StoreMeta;
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Resolve the nearest git repo root and whether one was actually found. */
function resolveRepo(cwd: string): { root: string; isRepo: boolean } {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return { root: dir, isRepo: true };
    const parent = dirname(dir);
    if (parent === dir) return { root: cwd, isRepo: false };
    dir = parent;
  }
}

function globalStorePath(): string {
  return join(getAgentDir(), "permissions.json");
}

function claudeUserPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

interface Paths {
  claudeUser: string;
  claudeProject: string;
  claudeProjectLocal: string;
  globalStore: string;
  projectStore: string;
  isRepo: boolean;
}

function paths(cwd: string): Paths {
  const { root, isRepo } = resolveRepo(cwd);
  return {
    claudeUser: claudeUserPath(),
    claudeProject: join(root, ".claude", "settings.json"),
    claudeProjectLocal: join(root, ".claude", "settings.local.json"),
    globalStore: globalStorePath(),
    projectStore: join(root, ".pi", "permissions.json"),
    isRepo,
  };
}

/** Read and merge every rule source (does not include skill / session rules). */
export function loadRuleSet(cwd: string): RuleSet {
  const p = paths(cwd);
  return mergeRuleSets(
    [p.claudeUser, p.claudeProject, p.claudeProjectLocal, p.globalStore, p.projectStore].map((f) =>
      extractPermissions(readJson(f)),
    ),
  );
}

/** Where an "allow always" rule is persisted: project store in a repo, else global. */
export function writeTarget(cwd: string): string {
  const { root, isRepo } = resolveRepo(cwd);
  return isRepo ? join(root, ".pi", "permissions.json") : globalStorePath();
}

/** Append an allow rule to the appropriate store (idempotent). Returns the file written. */
export function addAlwaysRule(cwd: string, rule: string): string {
  const file = writeTarget(cwd);
  const store = (readJson(file) as DedicatedStore | undefined) ?? {};
  const allow = toStringArray(store.allow);
  if (!allow.includes(rule)) allow.push(rule);
  store.allow = allow;
  writeJson(file, store);
  return file;
}

export interface ImportResult {
  count: number;
  file: string;
}

/** Import global Claude rules into the global store. Always runs; marks the store. */
export function importClaudeRules(): ImportResult {
  const file = globalStorePath();
  const store = (readJson(file) as DedicatedStore | undefined) ?? {};
  const claude = extractPermissions(readJson(claudeUserPath()));

  store.allow = [...new Set([...toStringArray(store.allow), ...claude.allow])];
  store.deny = [...new Set([...toStringArray(store.deny), ...claude.deny])];
  store.ask = [...new Set([...toStringArray(store.ask), ...claude.ask])];
  store.meta = { ...store.meta, importedFromClaude: true };
  writeJson(file, store);

  return { count: claude.allow.length + claude.deny.length + claude.ask.length, file };
}

/** Run the Claude import once, unless already imported or auto-import is opted out. */
export function autoImportIfNeeded(): ImportResult | null {
  const store = (readJson(globalStorePath()) as DedicatedStore | undefined) ?? {};
  if (store.meta?.importedFromClaude) return null;
  if (store.meta?.autoImport === false) return null;
  return importClaudeRules();
}

/** Opt in/out of automatic Claude import (persisted in the global store). */
export function setAutoImport(enabled: boolean): void {
  const file = globalStorePath();
  const store = (readJson(file) as DedicatedStore | undefined) ?? {};
  store.meta = { ...store.meta, autoImport: enabled };
  writeJson(file, store);
}
