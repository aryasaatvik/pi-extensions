import { describe, expect, it } from "vitest";

import { toExaCategory } from "../src/providers/exa/search.ts";

describe("toExaCategory", () => {
  it("maps research paper to the exa-js 2.26 publication category", () => {
    expect(toExaCategory("research paper")).toBe("publication");
  });

  it("drops pdf because exa-js 2.26 has no pdf category", () => {
    expect(toExaCategory("pdf")).toBeUndefined();
  });

  it("passes the categories the SDK still accepts", () => {
    expect(toExaCategory("news")).toBe("news");
    expect(toExaCategory(undefined)).toBeUndefined();
  });
});
