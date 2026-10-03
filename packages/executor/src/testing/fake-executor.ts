// A scripted Executor server on a real local port, so tests exercise the real
// fetch-based client end to end. Routes nobody scripted answer 501 with the
// route in the body, which fails the calling test loudly.

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingMessage["headers"];
  readonly body: unknown;
}

export interface FakeResponse {
  readonly status?: number;
  readonly body: unknown;
}

export type Route = (request: FakeRequest) => FakeResponse | Promise<FakeResponse>;

export interface FakeExecutor {
  readonly baseUrl: string;
  readonly requests: Array<FakeRequest>;
  /** Script `"<METHOD> <path>"`, e.g. `"POST /api/executions"`. */
  readonly route: (key: string, handler: Route) => void;
  readonly close: () => Promise<void>;
}

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? undefined : JSON.parse(text);
};

export const startFakeExecutor = async (): Promise<FakeExecutor> => {
  const routes = new Map<string, Route>();
  const requests: FakeRequest[] = [];

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? "/", "http://fake");
      const request: FakeRequest = {
        method: incoming.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
        headers: incoming.headers,
        body: await readBody(incoming),
      };
      requests.push(request);
      const key = `${request.method} ${request.path}`;
      const handler = routes.get(key);
      const response = handler
        ? await handler(request)
        : { status: 501, body: { unscripted: key } };
      outgoing.writeHead(response.status ?? 200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify(response.body));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    route: (key, handler) => void routes.set(key, handler),
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};

/** A completed execution as the Executor server formats it. */
export const completed = (result: unknown, extra: Record<string, unknown> = {}) => ({
  status: "completed",
  text: JSON.stringify(result, null, 2),
  structured: { status: "completed", result, logs: [] },
  isError: false,
  ...extra,
});

/** A paused execution waiting on a model-side confirmation gate. */
export const paused = (executionId: string, interaction: Record<string, unknown> = {}) => ({
  status: "paused",
  text: `Execution paused: Approve?\n\nexecutionId: ${executionId}`,
  structured: {
    status: "waiting_for_interaction",
    executionId,
    interaction: {
      kind: "form",
      message: "Approve creating an issue?",
      instructions: "Ask the user.",
      address: "tools.github_api.org.acme.issues.create",
      args: { title: "x" },
      requestedSchema: {},
      ...interaction,
    },
  },
});
