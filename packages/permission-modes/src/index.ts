import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { getSharedController } from "./controller.ts";
import { type PermissionMode, isPermissionMode, modeDisplay, nextMode } from "./modes.ts";
import { warmBashParser } from "./rules/bash-ast.ts";
import { autoImportIfNeeded, importClaudeRules, setAutoImport } from "./rules/sources.ts";

const STATUS_KEY = "permission-mode";
const MODE_ENTRY = "permission-mode";

export default function permissionModes(pi: ExtensionAPI): void {
  // Shared with any in-process child-agent gating (e.g. @pi-ext/subagents) so
  // mode + session grants propagate both ways. See controller.ts.
  const controller = getSharedController();

  pi.registerFlag("permission-mode", {
    description: "Initial permission mode: default | acceptEdits | plan | bypass",
    type: "string",
  });

  // Warm the tree-sitter bash parser so the first gated command isn't delayed.
  void warmBashParser();

  function updateStatus(ctx: ExtensionContext): void {
    const d = modeDisplay(controller.getMode());
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(d.color, `${d.symbol} ${d.label}`));
  }

  function setMode(next: PermissionMode, ctx: ExtensionContext, notify = true): void {
    controller.setMode(next);
    pi.appendEntry(MODE_ENTRY, { mode: next });
    updateStatus(ctx);
    if (notify) ctx.ui.notify(`Permission mode: ${modeDisplay(next).label}`, "info");
  }

  function cycleMode(ctx: ExtensionContext): void {
    setMode(nextMode(controller.getMode()), ctx);
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
        const skill = controller.skills.getActiveName();
        ctx.ui.notify(
          `Permission mode: ${modeDisplay(controller.getMode()).label}${skill ? ` · skill: ${skill}` : ""}\nShift+Tab to cycle.`,
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
    controller.skills.onInput(event.text);
  });

  pi.on("before_agent_start", async (event) => {
    controller.skills.cacheSkills(event.systemPromptOptions?.skills);
    controller.skills.resolvePending();
  });

  pi.on("session_start", async (_event, ctx) => {
    controller.setMode(
      restoreMode(ctx.sessionManager.getEntries()) ?? initialFlagMode(pi) ?? "default",
    );
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

  pi.on("tool_call", (event, ctx) =>
    controller.check({
      toolName: event.toolName,
      input: event.input as Record<string, unknown>,
      cwd: ctx.cwd,
      interactive: ctx.hasUI,
      ui: ctx.ui,
      // Approve-with-note: steer the note into the current turn so the model
      // sees it alongside the tool result.
      sendNote: (text) => pi.sendUserMessage(text, { deliverAs: "steer" }),
    }),
  );
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
