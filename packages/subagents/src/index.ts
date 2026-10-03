import { type ExtensionAPI, ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";

import { makeRuntime } from "./app/runtime.ts";
import { subagentsCommand } from "./commands/subagents.ts";
import { curatedModelIds } from "./models.ts";
import { JobsService } from "./services/jobs.ts";
import { makeTaskTool } from "./tools/task.ts";

export default async function piSubagents(pi: ExtensionAPI): Promise<void> {
  const runtime = makeRuntime(pi);

  // A registration-time snapshot of available models, surfaced to the model in the
  // task tool's guidelines so it can pick a valid `model` override. (Per-call errors
  // recompute this from the live registry for accuracy.) No network refresh: the
  // last-known model lists suffice, and a refresh would delay Pi's startup.
  let curatedModels: string[] = [];
  try {
    const models = await ModelRuntime.create({ refreshOnCreate: false });
    curatedModels = curatedModelIds(new ModelRegistry(models), undefined, 5);
  } catch {
    curatedModels = [];
  }

  pi.registerTool(makeTaskTool(runtime, curatedModels));

  pi.registerCommand("subagents", {
    description: "Sub-agents: list agents/tasks, `models`, `config`, `cancel <id|all>`",
    handler: async (args, ctx) => {
      const status = await runtime.runPromise(subagentsCommand(args, ctx));
      ctx.ui.notify(status.summary, status.level);
      ctx.ui.setStatus("subagents", status.statusBar);
    },
  });

  pi.on("session_shutdown", async () => {
    await runtime.runPromise(JobsService.use((jobs) => jobs.closeAll));
    await runtime.dispose();
  });
}
