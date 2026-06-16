import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";

import { listAgents } from "../agents/registry.ts";
import { curatedModelIds } from "../models.ts";
import { SubagentsConfigService } from "../services/config.ts";
import { JobsService } from "../services/jobs.ts";

export interface CommandStatus {
  readonly summary: string;
  readonly level: "info" | "warning" | "error";
  readonly statusBar: string;
}

export const subagentsCommand = (
  args: string,
  ctx: ExtensionCommandContext,
): Effect.Effect<CommandStatus, never, SubagentsConfigService | JobsService> =>
  Effect.gen(function* () {
    const config = yield* SubagentsConfigService;
    const jobs = yield* JobsService;
    const [verb, ...rest] = args.trim().split(/\s+/);

    if (verb === "config") {
      const settings = yield* config.resolve(ctx.cwd);
      return { summary: config.formatSummary(settings), level: "info", statusBar: "subagents" };
    }

    if (verb === "cancel") {
      const target = rest[0] ?? "all";
      const count = yield* jobs.cancel(target);
      return {
        summary: `Canceled ${count} running task(s).`,
        level: "info",
        statusBar: "subagents",
      };
    }

    if (verb === "models") {
      const ids = curatedModelIds(ctx.modelRegistry, ctx.model, 10);
      return {
        summary: ids.length
          ? `Models you can pass as the task \`model\` override:\n${ids.map((id) => `  ${id}`).join("\n")}`
          : "No models with configured auth found.",
        level: "info",
        statusBar: "subagents",
      };
    }

    const settings = yield* config.resolve(ctx.cwd);
    const agents = listAgents(ctx.cwd);
    const views = yield* jobs.list();
    const names = agents
      .map((a) => (a.source === "builtin" ? a.name : `${a.name} (${a.source})`))
      .join(", ");
    const taskLines =
      views.length === 0
        ? "  (none)"
        : views.map((v) => `  ${v.id}  ${v.agentType}  ${v.status}  ${v.description}`).join("\n");
    const running = views.filter((v) => v.status === "running").length;
    return {
      summary: [
        `Sub-agents (${agents.length}): ${names}`,
        `slots: ${settings.maxConcurrentPerSession}/session · ${settings.maxConcurrentGlobal}/global`,
        "tasks:",
        taskLines,
        "/subagents cancel <id|all> to stop background tasks.",
      ].join("\n"),
      level: "info",
      statusBar: `${running} running`,
    };
  });
