import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";

import type { AgentConfig } from "../agents/discovery.ts";
import { loadSubagentsSettings } from "../config/store.ts";
import type { SubagentRunDetails, SubagentRunStatus } from "../schemas/task.ts";
import { type SpawnRequest, type SpawnResult, runSubagent } from "./spawn.ts";

const NOTIFICATION_CAP = 4000;

export interface StartSpec {
  def: AgentConfig;
  prompt: string;
  description: string;
  modelOverride?: string;
  cwd: string;
  registry: ModelRegistry;
  parentModel: Model<any> | undefined;
  ui: ExtensionContext["ui"];
}

export interface JobView {
  id: string;
  agentType: string;
  description: string;
  status: SubagentRunStatus;
  tokens: number;
  ageMs: number;
  text?: string;
}

export type StartResult = { taskId: string } | { error: string };

interface Job {
  id: string;
  agentType: string;
  description: string;
  status: SubagentRunStatus;
  result?: SpawnResult;
  abort: AbortController;
  startedAt: number;
  progress: SubagentRunDetails;
}

// Process-wide running count for the global concurrency cap (sessions share a process).
const GLOBAL_KEY = Symbol.for("@pi-ext/subagents.globalRunning");
function globalCounter(): { n: number } {
  const g = globalThis as unknown as Record<symbol, { n: number } | undefined>;
  const box = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = { n: 0 });
  return box;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function notificationText(job: Job): string {
  return [
    "<task-notification>",
    `<task-id>${job.id}</task-id>`,
    `<agent>${job.agentType}</agent>`,
    `<description>${job.description}</description>`,
    `<status>${job.status}</status>`,
    "<result>",
    truncate(job.result?.text ?? "", NOTIFICATION_CAP),
    "</result>",
    `Use task(operation:"output", task_id:"${job.id}") for the full result.`,
    "</task-notification>",
  ].join("\n");
}

function toView(job: Job, now: number): JobView {
  return {
    id: job.id,
    agentType: job.agentType,
    description: job.description,
    status: job.status,
    tokens: job.progress.tokens,
    ageMs: now - job.startedAt,
    text: job.result?.text,
  };
}

export function createJobs(pi: ExtensionAPI) {
  const jobs = new Map<string, Job>();
  const global = globalCounter();
  let counter = 0;

  const sessionRunning = (): number =>
    [...jobs.values()].filter((j) => j.status === "running").length;

  const finish = (job: Job, result: SpawnResult): void => {
    if (job.status !== "running") return; // already canceled
    job.result = result;
    job.status =
      result.details.status === "canceled" ? "canceled" : result.isError ? "failed" : "done";
    job.progress = result.details;
    global.n = Math.max(0, global.n - 1);
    try {
      pi.sendUserMessage(notificationText(job), { deliverAs: "followUp" });
    } catch {
      // Injection is best-effort; the result is still available via operation:"output".
    }
  };

  const start = (spec: StartSpec): Effect.Effect<StartResult> =>
    Effect.gen(function* () {
      const settings = yield* loadSubagentsSettings(spec.cwd);
      if (sessionRunning() >= settings.maxConcurrentPerSession) {
        return {
          error: `Session task limit reached (${settings.maxConcurrentPerSession}). Wait for one to finish or cancel one.`,
        };
      }
      if (global.n >= settings.maxConcurrentGlobal) {
        return { error: `Global task limit reached (${settings.maxConcurrentGlobal}).` };
      }

      const id = `t${++counter}`;
      const abort = new AbortController();
      const job: Job = {
        id,
        agentType: spec.def.name,
        description: spec.description,
        status: "running",
        abort,
        startedAt: Date.now(),
        progress: {
          agentType: spec.def.name,
          description: spec.description,
          status: "running",
          toolCalls: [],
          tokens: 0,
          background: true,
          taskId: id,
        },
      };
      jobs.set(id, job);
      global.n += 1;

      // Background subagents run with their own AbortController (parent ESC does NOT
      // kill them) and interactive:false (no UI to prompt → gate fails closed).
      const req: SpawnRequest = {
        def: spec.def,
        prompt: spec.prompt,
        description: spec.description,
        modelOverride: spec.modelOverride,
        cwd: spec.cwd,
        registry: spec.registry,
        parentModel: spec.parentModel,
        ui: spec.ui,
        interactive: false,
        signal: abort.signal,
        background: true,
        onProgress: (details) => {
          job.progress = { ...details, taskId: id };
        },
      };

      void runSubagent(req)
        .then((result) => finish(job, result))
        .catch((cause) =>
          finish(job, {
            text: cause instanceof Error ? cause.message : String(cause),
            isError: true,
            details: { ...job.progress, status: "failed" },
          }),
        );

      return { taskId: id };
    });

  const output = (taskId: string): Effect.Effect<JobView | undefined> =>
    Effect.sync(() => {
      const job = jobs.get(taskId);
      return job ? toView(job, Date.now()) : undefined;
    });

  const list = (): Effect.Effect<JobView[]> =>
    Effect.sync(() => {
      const now = Date.now();
      return [...jobs.values()].map((job) => toView(job, now));
    });

  const cancel = (target: string): Effect.Effect<number> =>
    Effect.sync(() => {
      let count = 0;
      for (const job of jobs.values()) {
        if (job.status !== "running") continue;
        if (target !== "all" && job.id !== target) continue;
        job.abort.abort();
        job.status = "canceled";
        global.n = Math.max(0, global.n - 1);
        count += 1;
      }
      return count;
    });

  const closeAll: Effect.Effect<void> = Effect.sync(() => {
    for (const job of jobs.values()) {
      if (job.status === "running") {
        job.abort.abort();
        job.status = "canceled";
        global.n = Math.max(0, global.n - 1);
      }
    }
  });

  return { start, output, list, cancel, closeAll };
}

export class JobsService extends Context.Service<
  JobsService,
  {
    readonly start: (spec: StartSpec) => Effect.Effect<StartResult>;
    readonly output: (taskId: string) => Effect.Effect<JobView | undefined>;
    readonly list: () => Effect.Effect<JobView[]>;
    readonly cancel: (target: string) => Effect.Effect<number>;
    readonly closeAll: Effect.Effect<void>;
  }
>()("@pi-subagents/JobsService") {
  static layer(pi: ExtensionAPI): Layer.Layer<JobsService> {
    return Layer.succeed(this)(createJobs(pi));
  }
}
