// How a paused execution gets answered.
//
// Executor pauses an execution when a tool call needs approval (a form or a
// browser flow). The bridge answers through a policy instead of handing the
// model a resume tool, so one `executor_execute` call always ends completed.

import { Effect } from "effect";

import { ExecutorApprovalError } from "./errors.ts";
import type { Interaction, ResumeAction, ResumeAnswer } from "./schemas.ts";

/** A paused execution waiting for an answer. */
export interface ApprovalRequest extends Interaction {
  readonly executionId: string;
  readonly expiresAt?: string;
}

/**
 * `"decline"` and `"accept"` answer every request the same way; a function
 * decides per request and may return form `content` or a `persist` scope.
 */
export type ApprovalPolicy = "decline" | "accept" | ApprovalDecider;

/** Answers one paused execution. */
export type ApprovalDecider = (request: ApprovalRequest) => Promise<ResumeAction | ResumeAnswer>;

export const decide = (
  policy: ApprovalPolicy,
  request: ApprovalRequest,
): Effect.Effect<ResumeAnswer, ExecutorApprovalError> => {
  if (typeof policy === "string") return Effect.succeed({ action: policy });
  return Effect.tryPromise({
    try: () => policy(request),
    catch: (cause) =>
      new ExecutorApprovalError({
        executionId: request.executionId,
        address: request.address,
        cause,
      }),
  }).pipe(Effect.map((answer) => (typeof answer === "string" ? { action: answer } : answer)));
};
