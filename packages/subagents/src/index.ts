import { AuthStorage, type ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";

import { makeRuntime } from "./app/runtime.ts";
import { subagentsCommand } from "./commands/subagents.ts";
import { curatedModelIds } from "./models.ts";
import { JobsService } from "./services/jobs.ts";
import { makeTaskTool } from "./tools/task.ts";

export default function piSubagents(pi: ExtensionAPI): void {
  const runtime = makeRuntime(pi);

  // A registration-time snapshot of available models, surfaced to the model in the
  // task tool's guidelines so it can pick a valid `model` override. (Per-call errors
  // recompute this from the live registry for accuracy.)
  let curatedModels: string[] = [];
  try {
    curatedModels = curatedModelIds(ModelRegistry.create(AuthStorage.create()), undefined, 5);
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
