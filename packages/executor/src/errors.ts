import { Schema } from "effect";

/** The Executor connection settings are missing or unreadable. */
export class ExecutorConfigError extends Schema.TaggedError<ExecutorConfigError>()(
  "ExecutorConfigError",
  {
    message: Schema.String,
  },
) {}

/**
 * An Executor HTTP call failed before a decodable response arrived: transport
 * failure, timeout, or a non-2xx status. `body` holds the server's error
 * payload when there was one (Executor errors are tagged JSON such as
 * `{"_tag":"ApprovalExpiredError",...}`).
 */
export class ExecutorRequestError extends Schema.TaggedError<ExecutorRequestError>()(
  "ExecutorRequestError",
  {
    method: Schema.String,
    path: Schema.String,
    status: Schema.optional(Schema.Number),
    body: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

/** Executor answered 2xx with a payload this package does not understand. */
export class ExecutorDecodeError extends Schema.TaggedError<ExecutorDecodeError>()(
  "ExecutorDecodeError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

/** An execution kept pausing past the resume budget for one tool call. */
export class ExecutorResumeLimitError extends Schema.TaggedError<ExecutorResumeLimitError>()(
  "ExecutorResumeLimitError",
  {
    executionId: Schema.String,
    resumes: Schema.Number,
  },
) {
  override get message(): string {
    return `Execution ${this.executionId} was still paused after ${this.resumes} approvals.`;
  }
}

/** The approval policy threw while answering a paused execution. */
export class ExecutorApprovalError extends Schema.TaggedError<ExecutorApprovalError>()(
  "ExecutorApprovalError",
  {
    executionId: Schema.String,
    address: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Approval policy failed for ${this.address} (execution ${this.executionId}): ${String(this.cause)}`;
  }
}

export type ExecutorError = ExecutorRequestError | ExecutorDecodeError;
