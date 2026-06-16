import { type Static, Type } from "@earendil-works/pi-ai";

export const TaskToolInput = Type.Object({
  operation: Type.Union(
    [Type.Literal("spawn"), Type.Literal("output"), Type.Literal("list"), Type.Literal("cancel")],
    {
      description:
        "spawn: run a subagent. output: fetch a background task's result. list: show live tasks. cancel: stop a task.",
    },
  ),
  subagent_type: Type.Optional(
    Type.String({
      description: "Agent name for spawn (e.g. 'general-purpose', 'explore', or a project agent).",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "A short (3-5 word) description of the task, shown in the UI." }),
  ),
  prompt: Type.Optional(
    Type.String({ description: "The full task prompt for the subagent (spawn only)." }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Override model as 'provider/model-id'. Defaults to the agent definition's model, else the parent's model.",
    }),
  ),
  background: Type.Optional(
    Type.Boolean({
      description:
        "Run detached: returns a task_id immediately and notifies the parent on completion.",
    }),
  ),
  task_id: Type.Optional(Type.String({ description: "Target task id for output/cancel." })),
  all: Type.Optional(Type.Boolean({ description: "For cancel: cancel every running task." })),
});

export type TaskToolInput = Static<typeof TaskToolInput>;

export type SubagentRunStatus = "running" | "done" | "failed" | "blocked" | "canceled";

export interface SubagentToolCallView {
  tool: string;
  summary: string;
}

/** Structured details carried on the tool result, used by renderResult. */
export interface SubagentRunDetails {
  agentType: string;
  description: string;
  status: SubagentRunStatus;
  toolCalls: SubagentToolCallView[];
  tokens: number;
  background: boolean;
  taskId?: string;
  error?: string;
}
