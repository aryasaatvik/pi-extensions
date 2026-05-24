import { Type, type Static } from "@earendil-works/pi-ai";
import { Schema } from "effect";

export const ExecuteInput = Type.Object({
  code: Type.String({
    description:
      "Executor TypeScript code to run. The sandbox exposes configured tools as tools.*.",
  }),
});

export type ExecuteInput = Static<typeof ExecuteInput>;

export const ExecuteDetails = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("completed"),
    result: Schema.Unknown,
    logs: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    error: Schema.String,
    logs: Schema.Array(Schema.String),
  }),
]);

export type ExecuteDetails = typeof ExecuteDetails.Type;
