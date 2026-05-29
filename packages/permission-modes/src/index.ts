import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  MUTATING_TOOLS,
  type PermissionMode,
  isPermissionMode,
  modeDisplay,
  nextMode,
} from "./modes.ts";
import { promptForTool } from "./prompt.ts";
import { analyzeBash, warmBashParser } from "./rules/bash-ast.ts";
import { type Decision, type RuleSet, type ToolCall, decide } from "./rules/engine.ts";
import {
  addAlwaysRule,
  autoImportIfNeeded,
  importClaudeRules,
  loadRuleSet,
  setAutoImport,
} from "./rules/sources.ts";
import { bashScopeRule, pathScopeRule } from "./scope.ts";
import { SkillTracker } from "./skills.ts";

const STATUS_KEY = "permission-mode";
const MODE_ENTRY = "permission-mode";

export default function permissionModes(pi: ExtensionAPI): void {
  let mode: PermissionMode = "default";
  const sessionAllow = new Set<string>();
  const skills = new SkillTracker();

  pi.registerFlag("permission-mode", {
    description: "Initial permission mode: default | acceptEdits | plan | bypass",
    type: "string",
  });

  // Warm the tree-sitter bash parser so the first gated command isn't delayed.
  void warmBashParser();

  function updateStatus(ctx: ExtensionContext): void {
    const d = modeDisplay(mode);
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(d.color, `${d.symbol} ${d.label}`));
  }

  function setMode(next: PermissionMode, ctx: ExtensionContext, notify = true): void {
    mode = next;
    pi.appendEntry(MODE_ENTRY, { mode });
    updateStatus(ctx);
    if (notify) ctx.ui.notify(`Permission mode: ${modeDisplay(mode).label}`, "info");
  }

  function cycleMode(ctx: ExtensionContext): void {
    setMode(nextMode(mode), ctx);
  }

  pi.registerShortcut(Key.shift("tab"), {
    description: "Cycle permission mode",
    handler: cycleMode,
  });
  pi.registerShortcut(Key.ctrlShift("a"), {
    description: "Cycle permission mode (fallback)",
    handler: cycleMode,
  });

  pi.registerCommand("permissions", {
    description:
      "Permission mode (default|acceptEdits|plan|bypass), `import`, or `auto-import on|off`",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg === "import") {
        const r = importClaudeRules();
        ctx.ui.notify(`Imported ${r.count} rule(s) from Claude into ${r.file}`, "info");
        return;
      }
      if (arg === "auto-import on" || arg === "auto-import off") {
        const on = arg.endsWith("on");
        setAutoImport(on);
        ctx.ui.notify(`Claude auto-import ${on ? "enabled" : "disabled"}.`, "info");
        return;
      }
      if (arg === "" || arg === "status") {
        const skill = skills.getActiveName();
        ctx.ui.notify(
          `Permission mode: ${modeDisplay(mode).label}${skill ? ` · skill: ${skill}` : ""}\nShift+Tab to cycle.`,
          "info",
        );
        return;
      }
      if (isPermissionMode(arg)) {
        setMode(arg, ctx, false);
        ctx.ui.notify(`Permission mode set to ${modeDisplay(arg).label}.`, "info");
        return;
      }
      ctx.ui.notify(
        `Unknown: "${arg}". Use default | acceptEdits | plan | bypass | import | auto-import on|off.`,
        "warning",
      );
    },
  });

  pi.on("input", async (event) => {
    skills.onInput(event.text);
  });

  pi.on("before_agent_start", async (event) => {
    skills.cacheSkills(event.systemPromptOptions?.skills);
    skills.resolvePending();
  });

  pi.on("session_start", async (_event, ctx) => {
    mode = restoreMode(ctx.sessionManager.getEntries()) ?? initialFlagMode(pi) ?? "default";
    try {
      const r = autoImportIfNeeded();
      if (r && r.count > 0) {
        ctx.ui.notify(`Imported ${r.count} permission rule(s) from Claude into ${r.file}`, "info");
      }
    } catch {
      // Import is best-effort; ignore filesystem errors.
    }
    updateStatus(ctx);
  });

  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
    const call = await toToolCall(event);
    const rules = currentRuleSet(ctx);
    const decision = decide(call, rules);
    const mutating = MUTATING_TOOLS.has(call.toolName);

    // 1. Explicit deny wins in every mode.
    if (decision === "deny")
      return { block: true, reason: `Blocked by a deny rule: ${describe(call)}` };

    // 2. Bypass: allow everything else.
    if (mode === "bypass") return undefined;

    // 3. Plan: block all mutations.
    if (mode === "plan") {
      if (mutating) {
        return {
          block: true,
          reason: `Plan mode is active — ${call.toolName} is blocked. Press Shift+Tab to change mode.`,
        };
      }
      return undefined;
    }

    // 4. Explicit allow.
    if (decision === "allow") return undefined;

    // 5. acceptEdits auto-allows file edits (bash still gated below).
    if (mode === "acceptEdits" && (call.toolName === "edit" || call.toolName === "write"))
      return undefined;

    // 6. Non-mutating tools with no explicit ask run freely.
    if (!mutating && decision !== "ask") return undefined;

    // 7. Prompt (explicit ask, or a mutating tool with no allow rule).
    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Permission required for ${describe(call)} but no interactive UI is available. Use bypass mode or add an allow rule.`,
      };
    }

    const scope = scopeRuleFor(call);
    const choice = await promptForTool(ctx, promptTitle(call, decision));
    switch (choice) {
      case "once":
        return undefined;
      case "session":
        if (scope) sessionAllow.add(scope);
        return undefined;
      case "always":
        if (scope) {
          sessionAllow.add(scope);
          try {
            const file = addAlwaysRule(ctx.cwd, scope);
            ctx.ui.notify(`Saved allow rule to ${file}`, "info");
          } catch {
            ctx.ui.notify("Could not write the permissions file.", "error");
          }
        }
        return undefined;
      default:
        return { block: true, reason: `Denied by user: ${describe(call)}` };
    }
  });

  function currentRuleSet(ctx: ExtensionContext): RuleSet {
    const base = loadRuleSet(ctx.cwd);
    return {
      allow: [...base.allow, ...skills.getActiveAllow(), ...sessionAllow],
      deny: base.deny,
      ask: base.ask,
    };
  }

  function scopeRuleFor(call: ToolCall): string | null {
    if (call.toolName === "bash") return bashScopeRule(call.command ?? "");
    if (call.toolName === "edit" || call.toolName === "write")
      return pathScopeRule(call.toolName, call.path);
    return null;
  }
}

async function toToolCall(event: ToolCallEvent): Promise<ToolCall> {
  const input = event.input as Record<string, unknown>;
  if (event.toolName === "bash") {
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
  return { toolName: event.toolName, path };
}

function describe(call: ToolCall): string {
  if (call.toolName === "bash") return `bash: ${truncate(call.command ?? "", 80)}`;
  if (call.path) return `${call.toolName} ${call.path}`;
  return call.toolName;
}

function promptTitle(call: ToolCall, decision: Decision | undefined): string {
  const prefix = decision === "ask" ? "Permission rule asks to confirm" : "Approve";
  if (call.toolName === "bash")
    return `${prefix} — run command?\n\n  ${truncate(call.command ?? "", 200)}`;
  if (call.path) return `${prefix} — ${call.toolName} ${call.path}?`;
  return `${prefix} — ${call.toolName}?`;
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function restoreMode(entries: readonly SessionEntry[]): PermissionMode | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "custom" && e.customType === MODE_ENTRY) {
      const data = e.data as { mode?: string } | undefined;
      if (data?.mode && isPermissionMode(data.mode)) return data.mode;
    }
  }
  return undefined;
}

function initialFlagMode(pi: ExtensionAPI): PermissionMode | undefined {
  const flag = pi.getFlag("permission-mode");
  return typeof flag === "string" && isPermissionMode(flag) ? flag : undefined;
}
