import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MUTATING_TOOLS, type PermissionMode } from "./modes.ts";
import { promptForTool } from "./prompt.ts";
import { analyzeBash } from "./rules/bash-ast.ts";
import { type Decision, type RuleSet, type ToolCall, decide } from "./rules/engine.ts";
import { addAlwaysRule, loadRuleSet } from "./rules/sources.ts";
import { bashScopeRule, pathScopeRule } from "./scope.ts";
import { SkillTracker } from "./skills.ts";

type Ui = ExtensionContext["ui"];

/** Block/allow verdict. Structurally identical to the harness `ToolCallEventResult` and the agent `BeforeToolCallResult`, so one `check()` serves both the main agent and in-process child agents. */
export interface CheckResult {
  block?: boolean;
  reason?: string;
}

export interface CheckRequest {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  /** Foreground callers (true) may prompt via `ui`; background callers (false) fail closed. */
  interactive: boolean;
  ui?: Ui;
  /** Optional label of the caller (e.g. a subagent name) for prompt attribution. */
  originLabel?: string;
  /**
   * Deliver a freeform user note to the model when the user approves WITH a note
   * (the tool still runs). Wired by the main agent to `pi.sendUserMessage`.
   * Omitted by background/child callers, in which case the note is dropped.
   */
  sendNote?: (text: string) => void;
}

/**
 * Stateful, shareable permission decision engine. ONE instance is shared between
 * the permission-modes extension (gating the main agent's `tool_call`) and any
 * other extension gating in-process child agents (e.g. `@pi-ext/subagents`
 * calling this from `Agent.beforeToolCall`). Sharing the instance means the live
 * mode, the session-allow grants, and prompt serialization are common to both —
 * so permission decisions propagate in both directions automatically.
 */
export class PermissionController {
  private mode: PermissionMode = "default";
  /** Allow-rule scopes granted "for this session" (shared across main + child agents). */
  readonly sessionAllow = new Set<string>();
  readonly skills = new SkillTracker();
  /** Serializes interactive prompts so concurrent child agents don't collide on the UI. */
  private promptChain: Promise<unknown> = Promise.resolve();

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /** Merge disk rules with active-skill allows and session grants. */
  getCurrentRuleSet(cwd: string): RuleSet {
    const base = loadRuleSet(cwd);
    return {
      allow: [...base.allow, ...this.skills.getActiveAllow(), ...this.sessionAllow],
      deny: base.deny,
      ask: base.ask,
    };
  }

  /**
   * Decide whether a tool call may proceed. Returns `undefined` to allow, or
   * `{ block: true, reason }` to block. Decision flow (identical for the main
   * agent and child agents): deny > plan-blocks-mutation > bypass > allow >
   * acceptEdits > non-mutating-free > prompt.
   */
  async check(req: CheckRequest): Promise<CheckResult | undefined> {
    const call = await toToolCall(req.toolName, req.input);
    const decision = decide(call, this.getCurrentRuleSet(req.cwd));
    const mutating = MUTATING_TOOLS.has(call.toolName);

    // 1. Explicit deny wins in every mode.
    if (decision === "deny")
      return { block: true, reason: `Blocked by a deny rule: ${describe(call)}` };

    // 2. Bypass: allow everything else.
    if (this.mode === "bypass") return undefined;

    // 3. Plan: block all mutations.
    if (this.mode === "plan") {
      if (mutating)
        return {
          block: true,
          reason: `Plan mode is active — ${call.toolName} is blocked. Press Shift+Tab to change mode.`,
        };
      return undefined;
    }

    // 4. Explicit allow.
    if (decision === "allow") return undefined;

    // 5. acceptEdits auto-allows file edits (bash still gated below).
    if (this.mode === "acceptEdits" && (call.toolName === "edit" || call.toolName === "write"))
      return undefined;

    // 6. Non-mutating tools with no explicit ask run freely.
    if (!mutating && decision !== "ask") return undefined;

    // 7. Prompt (explicit ask, or a mutating tool with no allow rule).
    if (!req.interactive || !req.ui) {
      const where = req.originLabel ? ` (subagent "${req.originLabel}")` : "";
      return {
        block: true,
        reason: `Permission required for ${describe(call)}${where} but no interactive prompt is available. Use bypass mode or add an allow rule.`,
      };
    }

    const ui = req.ui;
    const scope = scopeRuleFor(call);
    const outcome = await this.serialize(() =>
      promptForTool(ui, promptTitle(call, decision, req.originLabel)),
    );
    // Deny: a note becomes the redirect the model sees as the blocked-tool result.
    if (outcome.choice === "deny") {
      return {
        block: true,
        reason: outcome.note
          ? `User declined ${describe(call)} and asks you to do this instead: ${outcome.note}`
          : `Denied by user: ${describe(call)}`,
      };
    }

    // Allow (once | session | always). Persist scope grants first.
    if (outcome.choice === "session" && scope) this.sessionAllow.add(scope);
    if (outcome.choice === "always" && scope) {
      this.sessionAllow.add(scope);
      try {
        const file = addAlwaysRule(req.cwd, scope);
        ui.notify(`Saved allow rule to ${file}`, "info");
      } catch {
        ui.notify("Could not write the permissions file.", "error");
      }
    }
    // The tool runs; deliver any note the user typed as steering to the model.
    if (outcome.note) req.sendNote?.(outcome.note);
    return undefined;
  }

  /** Run `fn` after any in-flight prompt resolves, chaining to serialize UI access. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.promptChain.then(fn, fn);
    this.promptChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const CONTROLLER_KEY = Symbol.for("@pi-ext/permission-modes.controller");

/**
 * The process-wide shared controller. Both the permission-modes extension and
 * any consumer (e.g. `@pi-ext/subagents`) call this to obtain the SAME instance,
 * keyed on a global Symbol so it survives even if the module is resolved twice.
 */
export function getSharedController(): PermissionController {
  const g = globalThis as unknown as Record<symbol, PermissionController | undefined>;
  const existing = g[CONTROLLER_KEY];
  if (existing) return existing;
  const created = new PermissionController();
  g[CONTROLLER_KEY] = created;
  return created;
}

async function toToolCall(toolName: string, input: Record<string, unknown>): Promise<ToolCall> {
  if (toolName === "bash") {
    const command = String(input.command ?? "");
    try {
      const { commands } = await analyzeBash(command);
      return { toolName: "bash", command, bashCommands: commands };
    } catch {
      // Parser unavailable — fail safe: don't auto-allow; deny/ask still apply.
      return { toolName: "bash", command, bashUnparsed: true };
    }
  }
  const path = (input.path ?? input.file_path) as string | undefined;
  return { toolName, path };
}

function scopeRuleFor(call: ToolCall): string | null {
  if (call.toolName === "bash") return bashScopeRule(call.command ?? "");
  if (call.toolName === "edit" || call.toolName === "write")
    return pathScopeRule(call.toolName, call.path);
  return null;
}

function describe(call: ToolCall): string {
  if (call.toolName === "bash") return `bash: ${truncate(call.command ?? "", 80)}`;
  if (call.path) return `${call.toolName} ${call.path}`;
  return call.toolName;
}

function promptTitle(call: ToolCall, decision: Decision | undefined, originLabel?: string): string {
  const who = originLabel ? `subagent "${originLabel}" — ` : "";
  const prefix = decision === "ask" ? "Permission rule asks to confirm" : "Approve";
  if (call.toolName === "bash")
    return `${who}${prefix} — run command?\n\n  ${truncate(call.command ?? "", 200)}`;
  if (call.path) return `${who}${prefix} — ${call.toolName} ${call.path}?`;
  return `${who}${prefix} — ${call.toolName}?`;
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
