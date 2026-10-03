import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { interactivePolicy } from "./extension.ts";
import type { ApprovalRequest } from "./policy.ts";

const request = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  executionId: "exec-1",
  kind: "form",
  message: "Create an issue?",
  instructions: "Ask the user.",
  address: "tools.github_api.org.acme.issues.create",
  args: { title: "x" },
  requestedSchema: {},
  ...overrides,
});

/** A context whose UI answers from a script; any other UI member throws. */
const context = (ui: Partial<ExtensionContext["ui"]>, hasUI = true): ExtensionContext => {
  const scripted = new Proxy(ui, {
    get: (target, key) => {
      const member = Reflect.get(target, key);
      if (member !== undefined) return member;
      return () => {
        throw new Error(`ui.${String(key)} is not scripted`);
      };
    },
  });
  return { hasUI, ui: scripted } as unknown as ExtensionContext;
};

describe("interactivePolicy", () => {
  it("declines without a UI", async () => {
    await expect(interactivePolicy(context({}, false))(request())).resolves.toEqual({
      action: "decline",
    });
  });

  it("accepts a confirmed call once when no persistence is offered", async () => {
    const policy = interactivePolicy(context({ confirm: async () => true }));
    await expect(policy(request())).resolves.toEqual({ action: "accept" });
  });

  it("passes the chosen persistence scope", async () => {
    const policy = interactivePolicy(
      context({ confirm: async () => true, select: async () => "session" }),
    );
    await expect(policy(request({ meta: { persist: ["session"] } }))).resolves.toEqual({
      action: "accept",
      persist: "session",
    });
  });

  it("cancels when the persistence prompt is dismissed", async () => {
    const policy = interactivePolicy(
      context({ confirm: async () => true, select: async () => undefined }),
    );
    await expect(policy(request({ meta: { persist: ["session"] } }))).resolves.toEqual({
      action: "cancel",
    });
  });
});
