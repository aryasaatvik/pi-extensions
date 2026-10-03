// Live smoke test against a real Executor: one search and one read-only
// execution through the public tool set. Configure it like the extension
// (`EXECUTOR_BASE_URL`, optional `EXECUTOR_CLIENT_ID[_FILE]` and
// `EXECUTOR_CLIENT_SECRET[_FILE]`). Prints the trace, never credentials.
//
//   bun run smoke ["search query"]

import { Effect } from "effect";

import * as ExecutorClient from "./client.ts";
import { executorTools, type ExecutorTraceRecord } from "./tools.ts";

const query = process.argv[2] ?? "list repository issues";
const client = ExecutorClient.create(await Effect.runPromise(ExecutorClient.optionsFromEnv));
const trace: ExecutorTraceRecord[] = [];
const [search, execute] = executorTools({ client, policy: "decline", trace });

const found = await search.execute("smoke-search", { query, limit: 3, includeDetails: true });
console.log(found.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"));

// Read-only: the sandbox's own discovery call.
const code = `const hits = await tools.search({ query: ${JSON.stringify(query)}, limit: 2 });\nreturn hits;`;
const ran = await execute.execute("smoke-execute", { code });
console.log(ran.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"));

for (const entry of trace) {
  console.log(
    `${entry.kind} isError=${entry.isError} durationMs=${entry.durationMs}${
      entry.kind === "execute"
        ? ` toolCalls=${entry.toolCalls?.length ?? "n/a"}`
        : ` hits=${Array.isArray(entry.result) ? entry.result.length : 0}`
    }`,
  );
}
if (trace.some((entry) => entry.isError)) process.exit(1);
