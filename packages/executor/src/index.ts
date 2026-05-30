import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";

import { executorStatusCommand } from "./commands/executor.ts";
import { makeRuntime } from "./app/runtime.ts";
import { ExecutorHostService } from "./services/executor-host.ts";
import { makeExecuteTool } from "./tools/execute.ts";
import { makeSearchTool } from "./tools/search.ts";

export default function piExecutor(pi: ExtensionAPI): void {
  const runtime = makeRuntime(pi);

  pi.registerTool(makeSearchTool(runtime));
  pi.registerTool(makeExecuteTool(runtime));

  pi.registerCommand("executor", {
    description: "Inspect and manage the executor extension",
    handler: async (args, ctx) => {
      const status = await runtime.runPromise(executorStatusCommand(args, ctx));

      ctx.ui.notify(status.summary, status.level);
      ctx.ui.setStatus("executor", status.statusBar);
    },
  });

  pi.on("session_shutdown", async () => {
    await runtime.runPromise(
      ExecutorHostService.use((hosts) => hosts.closeAll),
    );
    await runtime.dispose();
  });
}
