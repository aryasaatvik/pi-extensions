import { Schema } from "effect";

export const SubagentsSettings = Schema.Struct({
  /** Max background tasks running concurrently within one session. */
  maxConcurrentPerSession: Schema.Number,
  /** Max background tasks running concurrently across all sessions in the process. */
  maxConcurrentGlobal: Schema.Number,
  /** Hard cap on a single subagent's returned text, in bytes. */
  outputCapBytes: Schema.Number,
  /** Optional default model ("provider/model-id") for agents that don't specify one. */
  defaultModel: Schema.optional(Schema.String),
});

export type SubagentsSettings = typeof SubagentsSettings.Type;

export const DefaultSubagentsSettings: SubagentsSettings = {
  maxConcurrentPerSession: 5,
  maxConcurrentGlobal: 15,
  outputCapBytes: 64 * 1024,
};
