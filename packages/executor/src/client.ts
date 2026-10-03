// Typed client for a hosted Executor's HTTP API.
//
// The server owns the sandbox, sources, secrets, and semantic search; this
// module only speaks its JSON API. Reads retry transient failures. Execution
// and resume POSTs never retry: a timed-out POST may already have run a tool.

import { Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientError } from "effect/http";
import { readFile } from "node:fs/promises";

import {
  ExecutorConfigError,
  ExecutorDecodeError,
  ExecutorRequestError,
  type ExecutorError,
} from "./errors.ts";
import {
  ExecutionResponse,
  SearchResponse,
  ToolSchemaView,
  type ResumeAnswer,
  type SearchItem,
} from "./schemas.ts";

const READ_TIMEOUT = Duration.seconds(30);
/** Executions run arbitrary user code against third-party APIs; allow long research calls. */
const EXECUTION_TIMEOUT = Duration.minutes(10);

/**
 * Where the Executor server is and how to authenticate. `access` is a
 * Cloudflare Access service token, sent as `CF-Access-Client-Id` /
 * `CF-Access-Client-Secret`; omit it for a server without Access in front.
 */
export interface Options {
  readonly baseUrl: string;
  readonly access?: {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
  };
}

export interface Interface {
  readonly baseUrl: string;
  /** Semantic tool search; each hit's `path` is callable as `tools.<path>`. */
  readonly search: (input: {
    readonly query: string;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<SearchItem>, ExecutorError>;
  /** TypeScript shapes for one tool, by search `path`. */
  readonly describe: (path: string) => Effect.Effect<ToolSchemaView, ExecutorError>;
  /** Run TypeScript in the server's sandbox. May come back paused for an approval. */
  readonly execute: (code: string) => Effect.Effect<ExecutionResponse, ExecutorError>;
  /** Answer a paused execution. */
  readonly resume: (
    executionId: string,
    answer: ResumeAnswer,
  ) => Effect.Effect<ExecutionResponse, ExecutorError>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@pi-ext/executor/ExecutorClient",
) {}

export const make = Effect.fn("ExecutorClient.make")(function* (options: Options) {
  const http = yield* HttpClient.HttpClient;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.access) {
    headers["CF-Access-Client-Id"] = options.access.clientId;
    headers["CF-Access-Client-Secret"] = Redacted.value(options.access.clientSecret);
  }

  const base = http.pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(`${baseUrl}/api`)),
    HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)),
  );
  const reads = base.pipe(HttpClient.retryTransient({ retryOn: "errors-and-responses", times: 3 }));

  const send = <A, I>(
    client: HttpClient.HttpClient,
    schema: Schema.Codec<A, I>,
    request: HttpClientRequest.HttpClientRequest,
    timeout: Duration.Duration,
  ): Effect.Effect<A, ExecutorError> => {
    const path = new URL(request.url, "http://executor").pathname;
    const failed = (fields: { status?: number; body?: string; message: string }) =>
      new ExecutorRequestError({ method: request.method, path, ...fields });
    return Effect.gen(function* () {
      const response = yield* client.execute(request).pipe(
        Effect.timeoutOption(timeout),
        Effect.mapError((error: HttpClientError.HttpClientError) =>
          failed({ message: error.message }),
        ),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(failed({ message: `timed out after ${Duration.format(timeout)}` })),
            onSome: Effect.succeed,
          }),
        ),
      );
      if (response.status < 200 || response.status >= 300) {
        const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        return yield* failed({
          status: response.status,
          body: body || undefined,
          message: `Executor answered ${response.status}`,
        });
      }
      const json = yield* response.json.pipe(
        Effect.mapError((error) => failed({ message: error.message })),
      );
      return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
        Effect.mapError((error) => new ExecutorDecodeError({ path, message: error.message })),
      );
    });
  };

  const post = (path: string, body: unknown) =>
    HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body));

  return Service.of({
    baseUrl,
    search: Effect.fn("ExecutorClient.search")(function* ({ query, limit }) {
      const response = yield* send(
        reads,
        SearchResponse,
        HttpClientRequest.get("/semantic-search/search", {
          urlParams: { q: query, limit: String(limit) },
        }),
        READ_TIMEOUT,
      );
      return response.items;
    }),
    describe: (path) =>
      send(
        reads,
        ToolSchemaView,
        HttpClientRequest.get("/tools/schema", { urlParams: { address: `tools.${path}` } }),
        READ_TIMEOUT,
      ).pipe(Effect.withSpan("ExecutorClient.describe")),
    execute: (code) =>
      send(base, ExecutionResponse, post("/executions", { code }), EXECUTION_TIMEOUT).pipe(
        Effect.withSpan("ExecutorClient.execute"),
      ),
    resume: (executionId, answer) =>
      send(
        base,
        ExecutionResponse,
        post(`/executions/${encodeURIComponent(executionId)}/resume`, answer),
        EXECUTION_TIMEOUT,
      ).pipe(Effect.withSpan("ExecutorClient.resume")),
  });
});

export const layer = (options: Options): Layer.Layer<Service> =>
  Layer.effect(Service)(make(options)).pipe(Layer.provide(FetchHttpClient.layer));

/** A client for Promise-based callers; uses the global `fetch`. */
export const create = (options: Options): Interface =>
  Effect.runSync(make(options).pipe(Effect.provide(FetchHttpClient.layer)));

const readSecretFile = (path: string) =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new ExecutorConfigError({ message: `Could not read ${path}: ${String(cause)}` }),
  }).pipe(Effect.map((value) => value.trim()));

/**
 * Read `Options` from the environment.
 *
 * - `EXECUTOR_BASE_URL` (required)
 * - `EXECUTOR_CLIENT_ID` or `EXECUTOR_CLIENT_ID_FILE`
 * - `EXECUTOR_CLIENT_SECRET` or `EXECUTOR_CLIENT_SECRET_FILE`
 *
 * The Access credentials are all-or-nothing: neither means no Access headers,
 * one without the other is a config error.
 */
export const optionsFromEnv: Effect.Effect<Options, ExecutorConfigError> = Effect.gen(function* () {
  const env = yield* Config.all({
    baseUrl: Config.String("EXECUTOR_BASE_URL"),
    clientId: Config.option(Config.String("EXECUTOR_CLIENT_ID")),
    clientIdFile: Config.option(Config.String("EXECUTOR_CLIENT_ID_FILE")),
    clientSecret: Config.option(Config.Redacted("EXECUTOR_CLIENT_SECRET")),
    clientSecretFile: Config.option(Config.String("EXECUTOR_CLIENT_SECRET_FILE")),
  }).pipe(Effect.mapError((error) => new ExecutorConfigError({ message: error.message })));

  const clientId = Option.isSome(env.clientId)
    ? Option.some(env.clientId.value)
    : Option.isSome(env.clientIdFile)
      ? Option.some(yield* readSecretFile(env.clientIdFile.value))
      : Option.none<string>();
  const clientSecret = Option.isSome(env.clientSecret)
    ? Option.some(env.clientSecret.value)
    : Option.isSome(env.clientSecretFile)
      ? Option.some(Redacted.make(yield* readSecretFile(env.clientSecretFile.value)))
      : Option.none<Redacted.Redacted<string>>();

  if (Option.isSome(clientId) !== Option.isSome(clientSecret)) {
    return yield* new ExecutorConfigError({
      message:
        "Set both an Executor client id (EXECUTOR_CLIENT_ID[_FILE]) and secret (EXECUTOR_CLIENT_SECRET[_FILE]), or neither.",
    });
  }

  return {
    baseUrl: env.baseUrl,
    ...(Option.isSome(clientId) && Option.isSome(clientSecret)
      ? { access: { clientId: clientId.value, clientSecret: clientSecret.value } }
      : {}),
  };
});
