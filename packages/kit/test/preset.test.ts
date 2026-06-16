import { describe, expect, it } from "vitest";
import askEntry from "../src/ask.ts";
import permissionModesEntry from "../src/permission-modes.ts";

describe("@pi-ext/kit preset entries", () => {
  it("re-exports the ask extension factory", () => {
    expect(typeof askEntry).toBe("function");
  });

  it("re-exports the permission-modes extension factory", () => {
    expect(typeof permissionModesEntry).toBe("function");
  });

  it("the two entries are distinct factories", () => {
    expect(askEntry).not.toBe(permissionModesEntry);
  });
});
