# @pi-ext/executor

[Executor](https://github.com/RhysSullivan/executor) tools for Pi. An agent searches Executor's tool
catalog (connected APIs such as GitHub, Google, or Linear, with credentials stored server-side) and
runs TypeScript against it in Executor's sandbox.

The package is a thin client over a running Executor server's HTTP API. The server owns the sandbox,
sources, secrets, policies, and semantic search; nothing runs locally.

## Tools

| Tool               | What it does                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `executor_search`  | Semantic search over the catalog. Returns callable paths and, with `includeDetails`, TypeScript types. |
| `executor_execute` | Runs a TypeScript snippet in the server's sandbox (`await tools.<path>(input)`, top-level `return`).   |

When a tool call needs approval, Executor pauses the execution. The bridge answers through an
**approval policy** and resumes, so each `executor_execute` call returns one completed result.

## Configuration

| Variable                                                  | Meaning                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `EXECUTOR_BASE_URL`                                       | The Executor server, e.g. `https://executor.example.com`. Required. |
| `EXECUTOR_CLIENT_ID` or `EXECUTOR_CLIENT_ID_FILE`         | Cloudflare Access service-token id.                                 |
| `EXECUTOR_CLIENT_SECRET` or `EXECUTOR_CLIENT_SECRET_FILE` | Cloudflare Access service-token secret.                             |

Set both Access values or neither (a server without Cloudflare Access in front needs neither).

## As a Pi extension

```bash
pi install npm:@pi-ext/executor
```

The extension registers both tools with terminal rendering, asks you in the terminal when an execution
needs approval (declining when Pi has no UI), and adds `/executor` to check the connection.

## In your own agent

`executorTools` returns `AgentTool`s for `@earendil-works/pi-agent-core`:

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { Effect } from "effect";
import { ExecutorClient, executorTools, type ExecutorTraceRecord } from "@pi-ext/executor";

const client = ExecutorClient.create(await Effect.runPromise(ExecutorClient.optionsFromEnv));
const trace: ExecutorTraceRecord[] = [];
const tools = executorTools({ client, policy: "decline", trace });
```

- `policy` is `"decline"`, `"accept"`, or `(request) => Promise<action | { action, content?, persist? }>`.
  `request` carries the paused tool's `address`, `message`, `args`, and any form `requestedSchema`.
- `trace` is an array or a callback; it receives one record per tool call, failures included:
  `{ kind: "search", query, result, isError, durationMs }` or
  `{ kind: "execute", code, result, isError, toolCalls?, approvals, durationMs }`.
- Effect users can provide `ExecutorClient.layer(options)` and read `ExecutorClient.Service`.

## Development

```bash
bun run --filter @pi-ext/executor check
# Live check against a real server (configured as above):
bun run --filter @pi-ext/executor smoke "list repository issues"
```
