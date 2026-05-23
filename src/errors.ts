import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ExecutorHostError extends Data.TaggedError("ExecutorHostError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ExecutionError extends Data.TaggedError("ExecutionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ElicitationUiError extends Data.TaggedError("ElicitationUiError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class RenderError extends Data.TaggedError("RenderError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
