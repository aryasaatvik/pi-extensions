import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import { type Model, streamSimple } from "@earendil-works/pi-ai";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type ExtensionContext,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";

import type { AgentConfig } from "../agents/discovery.ts";
import { curatedModelIds } from "../models.ts";
import type {
  SubagentRunDetails,
  SubagentRunStatus,
  SubagentToolCallView,
} from "../schemas/task.ts";
import { makeBeforeToolCall } from "./permissions.ts";

// Each factory returns a concretely schema-typed AgentTool<typeof xSchema>. We
// collect heterogeneous tools into one Agent tool list (AgentTool<any>[]), but a
// concrete tool is not directly assignable to AgentTool<any> under
// strictFunctionTypes (its `execute(params: {…})` property is contravariant vs
// `execute(params: unknown)`). The registry-level cast widens the schema generic;
// it's a safe widening, not an unsound `unknown` bypass.
const TOOL_FACTORIES = {
  read: createReadTool,
  bash: createBashTool,
  edit: createEditTool,
  write: createWriteTool,
  grep: createGrepTool,
  find: createFindTool,
  ls: createLsTool,
} as Record<string, (cwd: string) => AgentTool<any>>;

const DEFAULT_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** Build the child's scoped tool set. The `task` tool is never included (recursion guard). */
function buildTools(def: AgentConfig, cwd: string): AgentTool<any>[] {
  const names = def.tools ?? DEFAULT_TOOL_NAMES;
  const tools: AgentTool<any>[] = [];
  for (const name of names) {
    const base = name.split("(")[0]?.trim().toLowerCase() ?? "";
    const make = TOOL_FACTORIES[base];
    if (make) tools.push(make(cwd));
  }
  return tools;
}

function buildChildPrompt(def: AgentConfig, cwd: string): string {
  return `${def.systemPrompt}\n\nWorking directory: ${cwd}`;
}

type ModelResult = { model: Model<any> } | { error: string };

function resolveModel(
  registry: ModelRegistry,
  parent: Model<any> | undefined,
  override: string | undefined,
): ModelResult {
  const suggest = (): string => {
    const ids = curatedModelIds(registry, parent, 5);
    return ids.length ? ` Available models: ${ids.join(", ")}.` : "";
  };
  if (override) {
    const slash = override.indexOf("/");
    if (slash <= 0)
      return { error: `Invalid model "${override}" (expected provider/model-id).${suggest()}` };
    const found = registry.find(override.slice(0, slash), override.slice(slash + 1));
    if (!found) return { error: `Model "${override}" not found in the registry.${suggest()}` };
    if (!registry.hasConfiguredAuth(found))
      return { error: `Model "${override}" has no configured auth.${suggest()}` };
    return { model: found };
  }
  if (!parent)
    return {
      error: `No model available: the parent has no active model and the agent specifies none.${suggest()}`,
    };
  return { model: parent };
}

function makeStreamFn(registry: ModelRegistry): StreamFn {
  // `streamSimple` here is from this package's pinned pi-ai; the Agent's `StreamFn`
  // type comes from pi-agent-core's patch-newer pi-ai copy. Their
  // AssistantMessageEventStream classes differ only by a private field, so the cast
  // bridges a TS-only nominal gap — the stream is consumed purely by async iteration.
  const fn = async (
    model: Model<any>,
    context: Parameters<typeof streamSimple>[1],
    options: Parameters<typeof streamSimple>[2],
  ) => {
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(auth.error);
    return streamSimple(model, context, { ...options, apiKey: auth.apiKey, headers: auth.headers });
  };
  return fn as unknown as StreamFn;
}

function finalText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter(
        (c): c is { type: "text"; text: string } =>
          typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text",
      )
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function sumTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    const usage = (message as { usage?: { totalTokens?: number } }).usage;
    if (usage?.totalTokens) total += usage.totalTokens;
  }
  return total;
}

function summarizeArgs(tool: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  if (tool === "bash") return String(a.command ?? "");
  const target = a.path ?? a.file_path ?? a.pattern ?? a.query;
  return target ? String(target) : "";
}

export interface SpawnRequest {
  def: AgentConfig;
  prompt: string;
  description: string;
  modelOverride?: string;
  cwd: string;
  registry: ModelRegistry;
  parentModel: Model<any> | undefined;
  ui: ExtensionContext["ui"];
  interactive: boolean;
  signal: AbortSignal | undefined;
  background: boolean;
  onProgress?: (details: SubagentRunDetails) => void;
}

export interface SpawnResult {
  text: string;
  isError: boolean;
  details: SubagentRunDetails;
}

export async function runSubagent(req: SpawnRequest): Promise<SpawnResult> {
  const toolCalls: SubagentToolCallView[] = [];
  let tokens = 0;
  const detailsFor = (status: SubagentRunStatus, error?: string): SubagentRunDetails => ({
    agentType: req.def.name,
    description: req.description,
    status,
    toolCalls: [...toolCalls],
    tokens,
    background: req.background,
    error,
  });

  const resolved = resolveModel(req.registry, req.parentModel, req.modelOverride ?? req.def.model);
  if ("error" in resolved) {
    return { text: resolved.error, isError: true, details: detailsFor("failed", resolved.error) };
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: buildChildPrompt(req.def, req.cwd),
      model: resolved.model,
      tools: buildTools(req.def, req.cwd),
    },
    streamFn: makeStreamFn(req.registry),
    beforeToolCall: makeBeforeToolCall({
      cwd: req.cwd,
      ui: req.ui,
      interactive: req.interactive,
      originLabel: req.def.name,
    }),
  });

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      toolCalls.push({ tool: event.toolName, summary: summarizeArgs(event.toolName, event.args) });
      req.onProgress?.(detailsFor("running"));
    } else if (event.type === "message_end") {
      tokens = sumTokens(agent.state.messages);
      req.onProgress?.(detailsFor("running"));
    }
  });

  const onAbort = (): void => agent.abort();
  req.signal?.addEventListener("abort", onAbort);

  try {
    await agent.prompt(req.prompt);
    await agent.waitForIdle();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { text: message, isError: true, details: detailsFor("failed", message) };
  } finally {
    unsubscribe();
    req.signal?.removeEventListener("abort", onAbort);
  }

  tokens = sumTokens(agent.state.messages);
  const aborted = req.signal?.aborted ?? false;
  const text = finalText(agent.state.messages);
  return {
    text:
      text ||
      (aborted ? "(subagent canceled before producing output)" : "(subagent produced no output)"),
    isError: aborted,
    details: detailsFor(aborted ? "canceled" : "done"),
  };
}

export class SpawnService extends Context.Service<
  SpawnService,
  {
    readonly spawn: (req: SpawnRequest) => Effect.Effect<SpawnResult>;
  }
>()("@pi-subagents/SpawnService") {
  static readonly Default = Layer.succeed(this)({
    spawn: (req) => Effect.promise(() => runSubagent(req)),
  });
}
