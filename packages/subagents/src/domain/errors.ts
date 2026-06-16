import { Data } from "effect";

export class SubagentsConfigError extends Data.TaggedError("SubagentsConfigError")<{
  message: string;
  cause?: unknown;
}> {}

export class SubagentSpawnError extends Data.TaggedError("SubagentSpawnError")<{
  message: string;
  cause?: unknown;
}> {}
