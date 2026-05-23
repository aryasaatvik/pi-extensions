import { describe, expect, it } from "vitest";

import { isDebugNamespaceEnabled } from "./logger.ts";

describe("isDebugNamespaceEnabled", () => {
  it("supports DEBUG namespace matching", () => {
    expect(isDebugNamespaceEnabled(undefined)).toBe(false);
    expect(isDebugNamespaceEnabled("executor-pi")).toBe(true);
    expect(isDebugNamespaceEnabled("executor-pi:*")).toBe(true);
    expect(isDebugNamespaceEnabled("*")).toBe(true);
    expect(isDebugNamespaceEnabled("executor")).toBe(false);
  });

  it("supports comma, whitespace, and disabled patterns", () => {
    expect(isDebugNamespaceEnabled("foo, executor-pi")).toBe(true);
    expect(isDebugNamespaceEnabled("foo executor-pi:*")).toBe(true);
    expect(isDebugNamespaceEnabled("executor-pi,-executor-pi")).toBe(false);
  });
});
