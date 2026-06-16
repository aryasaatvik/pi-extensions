import { describe, expect, it } from "vitest";

import type { AgentConfig } from "../src/agents/discovery.ts";
import { capBytes, unknownToolNames } from "../src/services/spawn.ts";

const def = (tools?: string[]): AgentConfig => ({
  name: "a",
  description: "d",
  tools,
  systemPrompt: "",
  source: "project",
});

describe("capBytes (output cap)", () => {
  it("returns the text unchanged when within the cap", () => {
    expect(capBytes("hello", 1000)).toBe("hello");
  });

  it("is disabled for a non-positive cap", () => {
    const big = "x".repeat(5000);
    expect(capBytes(big, 0)).toBe(big);
    expect(capBytes(big, -1)).toBe(big);
  });

  it("truncates over-cap text, keeping a prefix and an elision marker", () => {
    const out = capBytes("a".repeat(500), 120);
    expect(out).not.toBe("a".repeat(500));
    expect(out.startsWith("aaaa")).toBe(true);
    expect(out).toContain("truncated");
    // The kept portion (before the marker) stays within the byte budget.
    const kept = out.slice(0, out.indexOf("\n…"));
    expect(Buffer.byteLength(kept, "utf8")).toBeLessThanOrEqual(120);
  });

  it("never splits a multi-byte char into a replacement char", () => {
    const out = capBytes("é".repeat(300), 100); // each é = 2 UTF-8 bytes
    expect(out).not.toContain("�");
    expect(out).toContain("truncated");
  });
});

describe("unknownToolNames", () => {
  it("is empty when the def declares no tools (inherits the default set)", () => {
    expect(unknownToolNames(def(undefined))).toEqual([]);
  });

  it("accepts known tools, including a (scope) suffix and odd casing", () => {
    expect(unknownToolNames(def(["read", "Bash", "edit(src/**)"]))).toEqual([]);
  });

  it("flags typo'd / unsupported tool names that would be silently dropped", () => {
    expect(unknownToolNames(def(["reaad", "grep", "nope"]))).toEqual(["reaad", "nope"]);
  });
});
