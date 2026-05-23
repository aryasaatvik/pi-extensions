import { Data } from "effect";

const maxCauseDepth = 6;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const causeOf = (value: unknown): unknown => (isObject(value) ? value.cause : undefined);

const messageOf = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (isObject(value) && typeof value.message === "string") return value.message;
  return String(value);
};

export const formatErrorWithCauses = (error: unknown): string => {
  const lines: string[] = [];
  let current: unknown = error;

  for (let depth = 0; current !== undefined && depth < maxCauseDepth; depth += 1) {
    const message = messageOf(current);
    lines.push(depth === 0 ? message : `Caused by: ${message}`);
    current = causeOf(current);
  }

  return lines.join("\n");
};

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
