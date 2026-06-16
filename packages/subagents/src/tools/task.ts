import {
  defineTool,
  type ExtensionContext,
  type ThemeColor,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Effect, type ManagedRuntime } from "effect";

import { listAgents, resolveAgent } from "../agents/registry.ts";
import type { AppServices } from "../app/layer.ts";
import { type SubagentRunDetails, type SubagentRunStatus, TaskToolInput } from "../schemas/task.ts";
import { type JobView, JobsService } from "../services/jobs.ts";
import { SpawnService } from "../services/spawn.ts";

const truncate = (text: string, max: number): string => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
};

const formatTokens = (count: number): string => {
  if (count < 1000) return count.toString();
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
};

const formatAge = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
};

const emptyDetails = (
  agentType: string,
  status: SubagentRunStatus = "failed",
): SubagentRunDetails => ({
  agentType,
  description: "",
  status,
  toolCalls: [],
  tokens: 0,
  background: false,
});

const viewDetails = (view: JobView): SubagentRunDetails => ({
  agentType: view.agentType,
  description: view.description,
  status: view.status,
  toolCalls: [],
  tokens: view.tokens,
  background: true,
  taskId: view.id,
});

const errorResult = (text: string, agentType: string) => ({
  content: [{ type: "text" as const, text }],
  details: emptyDetails(agentType),
  isError: true,
});

const formatList = (views: JobView[]): string => {
  if (views.length === 0) return "No background tasks.";
  const rows = views.map(
    (v) =>
      `${v.id}  ${v.agentType}  ${truncate(v.description, 32)}  ${v.status}  ${formatTokens(v.tokens)} tok  ${formatAge(v.ageMs)}`,
  );
  return [`id  agent  description  status  tokens  age`, ...rows].join("\n");
};

const formatOutput = (view: JobView): string => {
  if (view.status === "running") {
    return `Task ${view.id} (${view.agentType}) is still running — ${formatTokens(view.tokens)} tok, ${formatAge(view.ageMs)} elapsed.`;
  }
  return `Task ${view.id} (${view.agentType}) — ${view.status}\n\n${view.text ?? "(no output)"}`;
};

const progressText = (details: SubagentRunDetails): string => {
  const lines = [`${details.agentType} · ${details.description}`];
  for (const call of details.toolCalls.slice(-8)) {
    lines.push(`  ${call.tool} ${truncate(call.summary, 60)}`);
  }
  if (details.tokens > 0) lines.push(`  ${formatTokens(details.tokens)} tok`);
  return lines.join("\n");
};

const statusGlyph = (status: SubagentRunStatus): string =>
  status === "done"
    ? "✓"
    : status === "failed"
      ? "✗"
      : status === "canceled"
        ? "⊘"
        : status === "blocked"
          ? "⏸"
          : "●";

const statusColor = (status: SubagentRunStatus): ThemeColor =>
  status === "done"
    ? "success"
    : status === "failed"
      ? "error"
      : status === "canceled" || status === "blocked"
        ? "warning"
        : "accent";

export const makeTaskTool = (
  runtime: ManagedRuntime.ManagedRuntime<AppServices, never>,
  curatedModels: string[] = [],
): ToolDefinition<typeof TaskToolInput, SubagentRunDetails> =>
  defineTool({
    name: "task",
    label: "Task",
    description: `Delegate a scoped piece of work to a sub-agent that runs with its own tools and context.

Use operation:"spawn" with a subagent_type and a complete, self-contained prompt. The subagent's final message is returned to you as the result — it cannot see your conversation, so include everything it needs. Spawn 'explore' for read-only investigation and 'general-purpose' for changes, or a project-defined agent.

Set background:true for long-running work: you get a task_id immediately and a notification when it finishes. Use operation:"output"/"list"/"cancel" to manage background tasks. Run independent subagents concurrently by emitting multiple task tool calls in one message.`,
    promptSnippet: "Delegate a scoped task to a sub-agent.",
    parameters: TaskToolInput,
    executionMode: "parallel",
    promptGuidelines: [
      'Use task(operation:"spawn", subagent_type, description, prompt) to delegate a self-contained task.',
      "Prefer 'explore' for read-only investigation; 'general-purpose' when changes are needed.",
      "The subagent has a fresh context — put everything it needs in the prompt; its final message is the result.",
      'Use background:true for long work, then task(operation:"output", task_id) to collect it.',
      "Launch independent subagents in parallel by sending multiple task tool calls in a single message.",
      curatedModels.length > 0
        ? `Optional 'model' is "provider/model-id"; available: ${curatedModels.join(", ")}. Omit to inherit the parent's model.`
        : `Optional 'model' is "provider/model-id"; omit to inherit the parent's model.`,
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      if (params.operation === "list") {
        const views = await runtime.runPromise(JobsService.use((jobs) => jobs.list()));
        return {
          content: [{ type: "text", text: formatList(views) }],
          details: emptyDetails("", "running"),
        };
      }

      if (params.operation === "output") {
        if (!params.task_id) return errorResult("output requires task_id.", "");
        const view = await runtime.runPromise(
          JobsService.use((jobs) => jobs.output(params.task_id ?? "")),
        );
        if (!view) return errorResult(`No background task with id "${params.task_id}".`, "");
        return {
          content: [{ type: "text", text: formatOutput(view) }],
          details: viewDetails(view),
        };
      }

      if (params.operation === "cancel") {
        const target = params.all ? "all" : params.task_id;
        if (!target) return errorResult("cancel requires task_id or all:true.", "");
        const count = await runtime.runPromise(JobsService.use((jobs) => jobs.cancel(target)));
        return {
          content: [{ type: "text", text: `Canceled ${count} running task(s).` }],
          details: emptyDetails("", count > 0 ? "canceled" : "running"),
        };
      }

      // operation === "spawn"
      const agentType = params.subagent_type;
      const prompt = params.prompt;
      if (!agentType || !prompt) {
        return errorResult("spawn requires both subagent_type and prompt.", agentType ?? "unknown");
      }

      const def = resolveAgent(ctx.cwd, agentType);
      if (!def) {
        const available = listAgents(ctx.cwd)
          .map((a) => a.name)
          .join(", ");
        return errorResult(
          `Unknown subagent_type "${agentType}". Available: ${available}.`,
          agentType,
        );
      }

      const description = params.description ?? agentType;

      if (params.background) {
        const started = await runtime.runPromise(
          JobsService.use((jobs) =>
            jobs.start({
              def,
              prompt,
              description,
              modelOverride: params.model,
              cwd: ctx.cwd,
              registry: ctx.modelRegistry,
              parentModel: ctx.model,
              ui: ctx.ui,
            }),
          ),
        );
        if ("error" in started) return errorResult(started.error, agentType);
        return {
          content: [
            {
              type: "text",
              text: `Started background task ${started.taskId} — ${agentType}: ${description}. You'll be notified on completion; fetch it with task(operation:"output", task_id:"${started.taskId}") or inspect with /subagents.`,
            },
          ],
          details: {
            agentType,
            description,
            status: "running",
            toolCalls: [],
            tokens: 0,
            background: true,
            taskId: started.taskId,
          },
        };
      }

      const result = await runtime.runPromise(
        SpawnService.use((spawn) =>
          spawn.spawn({
            def,
            prompt,
            description,
            modelOverride: params.model,
            cwd: ctx.cwd,
            registry: ctx.modelRegistry,
            parentModel: ctx.model,
            ui: ctx.ui,
            interactive: ctx.hasUI,
            signal,
            background: false,
            onProgress: (details) =>
              onUpdate?.({ content: [{ type: "text", text: progressText(details) }], details }),
          }),
        ),
      );

      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
        isError: result.isError,
      };
    },
    renderCall(args, theme) {
      const title = theme.fg("toolTitle", theme.bold("task"));
      const op =
        args.operation && args.operation !== "spawn" ? ` ${theme.fg("dim", args.operation)}` : "";
      const who = args.subagent_type ? ` ${theme.fg("accent", args.subagent_type)}` : "";
      const desc = args.description ? ` ${theme.fg("dim", truncate(args.description, 60))}` : "";
      return new Text(`${title}${op}${who}${desc}`, 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      const details = result.details;
      const glyph = isPartial ? "●" : statusGlyph(details.status);
      const color = isPartial ? "accent" : statusColor(details.status);
      const label = details.agentType
        ? `${glyph} ${details.agentType} · ${details.description}`
        : glyph;
      const lines = [theme.fg(color, theme.bold(label))];
      for (const call of details.toolCalls.slice(-8)) {
        lines.push(theme.fg("dim", `  ${call.tool} ${truncate(call.summary, 60)}`));
      }
      if (details.tokens > 0)
        lines.push(theme.fg("muted", `  ${formatTokens(details.tokens)} tok`));
      const content = result.content[0];
      const text = content?.type === "text" ? content.text : "";
      if (!isPartial && text) lines.push("", theme.fg("toolOutput", text));
      return new Text(lines.join("\n"), 0, 0);
    },
  });
