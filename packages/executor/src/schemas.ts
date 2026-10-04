// Wire models for the Executor HTTP API, hand-written against the server's
// HttpApi groups (`@executor-js/api` is private and pinned to an Effect beta).
// Every response is decoded through these; the TypeScript types derive from
// them.

import { Schema } from "effect";

/** One hit from `GET /api/semantic-search/search`. `path` is callable as `tools.<path>`. */
export const SearchItem = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  integration: Schema.String,
  score: Schema.Number,
});
export type SearchItem = typeof SearchItem.Type;

export const SearchResponse = Schema.Struct({
  items: Schema.Array(SearchItem),
});

/**
 * The fields of `GET /api/tools/schema` this package reads. The server sends
 * `null` for a missing preview (MCP tools have no TypeScript definitions), so
 * every optional field also accepts `null`.
 */
export const ToolSchemaView = Schema.Struct({
  address: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  inputTypeScript: Schema.optional(Schema.NullOr(Schema.String)),
  outputTypeScript: Schema.optional(Schema.NullOr(Schema.String)),
  typeScriptDefinitions: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
  ),
});
export type ToolSchemaView = typeof ToolSchemaView.Type;

/**
 * One tool call made by an execution. Optional on the wire until the Executor
 * fork reports it on completed executions.
 */
export const ToolCall = Schema.Struct({
  path: Schema.String,
  isError: Schema.Boolean,
  durationMs: Schema.optional(Schema.Number),
});
export type ToolCall = typeof ToolCall.Type;

/** `structured` of a completed execution, by outcome. */
export const CompletedOutcome = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("completed"),
    result: Schema.Unknown,
    toolName: Schema.optional(Schema.String),
    emitted: Schema.optional(Schema.Number),
    logs: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    error: Schema.String,
    emitted: Schema.optional(Schema.Number),
    logs: Schema.Array(Schema.String),
  }),
  // A resume that declined or cancelled an approval recorded by another
  // server instance: nothing ran.
  Schema.Struct({
    status: Schema.Literal("declined"),
    executionId: Schema.String,
    address: Schema.String,
  }),
]);
export type CompletedOutcome = typeof CompletedOutcome.Type;

export const CompletedExecution = Schema.Struct({
  status: Schema.Literal("completed"),
  text: Schema.String,
  structured: CompletedOutcome,
  isError: Schema.Boolean,
  toolCalls: Schema.optional(Schema.Array(ToolCall)),
});
export type CompletedExecution = typeof CompletedExecution.Type;

/** What a paused execution is waiting for. */
export const Interaction = Schema.Struct({
  kind: Schema.Literals(["url", "form"]),
  message: Schema.String,
  instructions: Schema.String,
  address: Schema.String,
  args: Schema.Unknown,
  url: Schema.optional(Schema.String),
  requestedSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type Interaction = typeof Interaction.Type;

export const PausedExecution = Schema.Struct({
  status: Schema.Literal("paused"),
  text: Schema.String,
  structured: Schema.Struct({
    status: Schema.Literal("waiting_for_interaction"),
    executionId: Schema.String,
    expiresAt: Schema.optional(Schema.String),
    interaction: Interaction,
  }),
});
export type PausedExecution = typeof PausedExecution.Type;

/** `POST /api/executions` and `POST /api/executions/:id/resume`. */
export const ExecutionResponse = Schema.Union([CompletedExecution, PausedExecution]);
export type ExecutionResponse = typeof ExecutionResponse.Type;

export const ResumeAction = Schema.Literals(["accept", "decline", "cancel"]);
export type ResumeAction = typeof ResumeAction.Type;

/** The body of `POST /api/executions/:id/resume`. */
export interface ResumeAnswer {
  readonly action: ResumeAction;
  /** Form values matching `interaction.requestedSchema`. */
  readonly content?: Record<string, unknown>;
  /** How long an accepted approval lasts, from the scopes `interaction.meta` offers. */
  readonly persist?: string;
}
