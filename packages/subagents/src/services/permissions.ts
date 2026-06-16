import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSharedController } from "@pi-ext/permission-modes/controller";

export interface GateOptions {
  cwd: string;
  ui: ExtensionContext["ui"];
  /** Foreground (sync) subagents may prompt; background subagents must not. */
  interactive: boolean;
  /** Subagent name, used to attribute prompts/denials in the parent UI. */
  originLabel: string;
}

/**
 * Build a `beforeToolCall` hook for a child Agent that defers to the SAME
 * PermissionController the main agent uses. Because the controller is a shared
 * singleton, the live mode and session grants apply to child tool calls too.
 */
export function makeBeforeToolCall(
  opts: GateOptions,
): (context: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined> {
  const controller = getSharedController();
  return (context) =>
    controller.check({
      toolName: context.toolCall.name,
      input: context.toolCall.arguments,
      cwd: opts.cwd,
      interactive: opts.interactive,
      ui: opts.ui,
      originLabel: opts.originLabel,
    });
}
