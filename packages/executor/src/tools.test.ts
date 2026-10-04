import { Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as ExecutorClient from "./client.ts";
import {
  completed,
  paused,
  startFakeExecutor,
  type FakeExecutor,
} from "./testing/fake-executor.ts";
import { executorTools, reachableDefinitions, type ExecutorTraceRecord } from "./tools.ts";

let server: FakeExecutor;
beforeEach(async () => {
  server = await startFakeExecutor();
});
afterEach(async () => {
  await server.close();
});

const tools = (policy: Parameters<typeof executorTools>[0]["policy"] = "decline") => {
  const trace: ExecutorTraceRecord[] = [];
  const client = ExecutorClient.create({ baseUrl: `${server.baseUrl}/` });
  const [search, execute] = executorTools({ client, policy, trace });
  return { search, execute, trace };
};

const text = (result: { content: ReadonlyArray<{ type: string; text?: string }> }) =>
  result.content.map((part) => part.text ?? "").join("");

const hit = {
  path: "github_api.org.acme.issues.listForRepo",
  name: "issues.listForRepo",
  description: "List issues in a repository.\n\nLong notes that should not reach the summary.",
  integration: "github_api",
  score: 0.97,
};

describe("executor_search", () => {
  it("returns callable paths and records the search", async () => {
    server.route("GET /api/semantic-search/search", () => ({
      body: { namespace: "default", query: "issues", items: [hit] },
    }));
    const { search, trace } = tools();

    const result = await search.execute("call-1", { query: "issues", limit: 3 });

    expect(server.requests[0]?.query.get("q")).toBe("issues");
    expect(server.requests[0]?.query.get("limit")).toBe("3");
    expect(text(result)).toContain(
      "tools.github_api.org.acme.issues.listForRepo — List issues in a repository.",
    );
    expect(text(result)).not.toContain("Long notes");
    expect(result.structuredContent).toEqual({ items: [hit] });
    expect(trace).toEqual([
      {
        kind: "search",
        query: "issues",
        result: [hit],
        isError: false,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it("adds TypeScript shapes and only the definitions they reach", async () => {
    server.route("GET /api/semantic-search/search", () => ({
      body: { namespace: "default", query: "q", items: [hit] },
    }));
    server.route("GET /api/tools/schema", (request) => ({
      body: {
        address: request.query.get("address"),
        inputTypeScript: "{ owner: string; repo: string }",
        outputTypeScript: "Issue[]",
        typeScriptDefinitions: {
          Issue: "{ id: number; user: User }",
          User: "{ login: string }",
          Gist: "{ id: string }",
        },
      },
    }));
    const { search } = tools();

    const result = await search.execute("call-1", { query: "q", includeDetails: true });

    expect(server.requests[1]?.query.get("address")).toBe(
      "tools.github_api.org.acme.issues.listForRepo",
    );
    expect(result.details.items[0]?.typeScriptDefinitions).toEqual({
      Issue: "{ id: number; user: User }",
      User: "{ login: string }",
    });
    expect(text(result)).toContain("  output: Issue[]");
    expect(text(result)).toContain("Types:\ntype Issue = { id: number; user: User }");
  });

  it("treats null schema previews as absent", async () => {
    server.route("GET /api/semantic-search/search", () => ({
      body: { namespace: "default", query: "q", items: [hit] },
    }));
    // MCP-backed tools: the server has no TypeScript preview and sends nulls.
    server.route("GET /api/tools/schema", (request) => ({
      body: {
        address: request.query.get("address"),
        name: null,
        description: null,
        inputTypeScript: "{ keyword: string }",
        outputTypeScript: null,
        typeScriptDefinitions: null,
        schemaDefinitions: null,
      },
    }));
    const { search } = tools();

    const result = await search.execute("call-1", { query: "q", includeDetails: true });

    expect(result.isError).toBeFalsy();
    expect(result.details.items).toEqual([{ ...hit, inputTypeScript: "{ keyword: string }" }]);
    expect(text(result)).toContain("  input: { keyword: string }");
  });

  it("keeps the other hits when one schema cannot be read", async () => {
    const other = { ...hit, path: "github_api.org.acme.issues.get", name: "issues.get" };
    server.route("GET /api/semantic-search/search", () => ({
      body: { namespace: "default", query: "q", items: [hit, other] },
    }));
    server.route("GET /api/tools/schema", (request) =>
      request.query.get("address") === `tools.${other.path}`
        ? { status: 404, body: { _tag: "ToolNotFoundError" } }
        : { body: { address: request.query.get("address"), inputTypeScript: "{ owner: string }" } },
    );
    const { search } = tools();

    const result = await search.execute("call-1", { query: "q", includeDetails: true });

    expect(result.isError).toBeFalsy();
    expect(result.details.items[0]).toEqual({ ...hit, inputTypeScript: "{ owner: string }" });
    expect(result.details.items[1]).toEqual({
      ...other,
      detailsError: expect.stringContaining("404"),
    });
    expect(text(result)).toContain("  types unavailable: ");
  });

  it("reports a server error as an error result and records it", async () => {
    server.route("GET /api/semantic-search/search", () => ({
      status: 500,
      body: { _tag: "InternalError" },
    }));
    const { search, trace } = tools();

    const result = await search.execute("call-1", { query: "issues" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Executor answered 500");
    expect(trace[0]).toMatchObject({ kind: "search", isError: true });
    // Reads retry transient failures before giving up.
    expect(server.requests.length).toBeGreaterThan(1);
  });
});

describe("executor_execute", () => {
  it("returns a completed result with its tool calls", async () => {
    const toolCalls = [{ path: "github_api.org.acme.repos.get", isError: false, durationMs: 120 }];
    server.route("POST /api/executions", () => ({ body: completed({ stars: 3 }, { toolCalls }) }));
    const { execute, trace } = tools();

    const result = await execute.execute("call-1", { code: "return 1" });

    expect(server.requests[0]?.body).toEqual({ code: "return 1" });
    expect(result.isError).toBe(false);
    expect(result.details.toolCalls).toEqual(toolCalls);
    expect(trace).toEqual([
      {
        kind: "execute",
        code: "return 1",
        result: { stars: 3 },
        isError: false,
        toolCalls,
        approvals: [],
        durationMs: expect.any(Number),
      },
    ]);
  });

  it("marks a script error as an error result", async () => {
    server.route("POST /api/executions", () => ({
      body: {
        status: "completed",
        text: "Error: boom",
        structured: { status: "error", error: "boom", logs: [] },
        isError: true,
      },
    }));
    const { execute, trace } = tools();

    const result = await execute.execute("call-1", { code: "throw 1" });

    expect(result.isError).toBe(true);
    expect(trace[0]).toMatchObject({ result: "boom", isError: true });
  });

  it("declines approvals under the decline policy", async () => {
    server.route("POST /api/executions", () => ({ body: paused("exec-1") }));
    server.route("POST /api/executions/exec-1/resume", () => ({
      body: {
        status: "completed",
        text: "Error: declined",
        structured: { status: "error", error: "declined", logs: [] },
        isError: true,
      },
    }));
    const { execute, trace } = tools("decline");

    const result = await execute.execute("call-1", { code: "await tools.x()" });

    expect(server.requests[1]?.body).toEqual({ action: "decline" });
    expect(text(result)).toContain("Approval decline: tools.github_api.org.acme.issues.create");
    expect(trace[0]).toMatchObject({
      approvals: [
        { action: "decline", address: "tools.github_api.org.acme.issues.create", kind: "form" },
      ],
    });
  });

  it("passes a policy's form content and persist scope through", async () => {
    server.route("POST /api/executions", () => ({
      body: paused("exec-2", {
        requestedSchema: { properties: { note: { type: "string" } } },
        meta: { persist: ["session"] },
      }),
    }));
    server.route("POST /api/executions/exec-2/resume", () => ({ body: completed("ok") }));
    const seen: string[] = [];
    const { execute } = tools(async (request) => {
      seen.push(`${request.executionId}:${request.message}`);
      return { action: "accept", content: { note: "hi" }, persist: "session" };
    });

    const result = await execute.execute("call-1", { code: "x" });

    expect(seen).toEqual(["exec-2:Approve creating an issue?"]);
    expect(server.requests[1]?.body).toEqual({
      action: "accept",
      content: { note: "hi" },
      persist: "session",
    });
    expect(result.isError).toBe(false);
  });

  it("stops after the resume budget", async () => {
    server.route("POST /api/executions", () => ({ body: paused("loop") }));
    server.route("POST /api/executions/loop/resume", () => ({ body: paused("loop") }));
    const { execute, trace } = tools("accept");

    const result = await execute.execute("call-1", { code: "x" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("still paused after 20 approvals");
    // Approvals answered before the failure are still reported.
    expect(result.details.approvals).toHaveLength(20);
    expect(trace[0]).toMatchObject({ isError: true });
    expect(trace[0]?.kind === "execute" && trace[0].approvals).toHaveLength(20);
    expect(text(result)).toContain("Approval accept: tools.github_api.org.acme.issues.create");
  });

  it("does not retry a failed execution request", async () => {
    server.route("POST /api/executions", () => ({ status: 503, body: { _tag: "InternalError" } }));
    const { execute, trace } = tools();

    const result = await execute.execute("call-1", { code: "x" });

    expect(server.requests).toHaveLength(1);
    expect(result.isError).toBe(true);
    expect(trace[0]).toMatchObject({ kind: "execute", isError: true, approvals: [] });
  });

  it("reports an approval that expired before the resume", async () => {
    server.route("POST /api/executions", () => ({ body: paused("gone") }));
    server.route("POST /api/executions/gone/resume", () => ({
      status: 410,
      body: { _tag: "ApprovalExpiredError", executionId: "gone" },
    }));
    const { execute } = tools("accept");

    const result = await execute.execute("call-1", { code: "x" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Executor answered 410");
  });
});

describe("ExecutorClient", () => {
  it("sends Cloudflare Access headers when configured", async () => {
    server.route("GET /api/semantic-search/search", () => ({
      body: { namespace: "default", query: "q", items: [] },
    }));
    const client = ExecutorClient.create({
      baseUrl: server.baseUrl,
      access: { clientId: "id-1", clientSecret: Redacted.make("secret-1") },
    });
    const [search] = executorTools({ client, policy: "decline" });

    await search.execute("call-1", { query: "q" });

    expect(server.requests[0]?.headers["cf-access-client-id"]).toBe("id-1");
    expect(server.requests[0]?.headers["cf-access-client-secret"]).toBe("secret-1");
  });

  it("fails on a payload it does not understand", async () => {
    server.route("POST /api/executions", () => ({ body: { status: "running" } }));
    const { execute } = tools();

    const result = await execute.execute("call-1", { code: "x" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Executor execution failed");
  });
});

describe("reachableDefinitions", () => {
  it("follows references transitively and matches whole names", () => {
    expect(
      reachableDefinitions(["Repo"], {
        Repo: "{ owner: Owner }",
        Owner: "{ login: string }",
        RepoLike: "{}",
      }),
    ).toEqual({ Repo: "{ owner: Owner }", Owner: "{ login: string }" });
  });
});
