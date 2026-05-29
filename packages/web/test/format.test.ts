import { describe, expect, it } from "vitest";

import {
  fetchHasSuccessfulContent,
  formatFetchAllErrors,
  formatFetchMarkdown,
  formatSearchMarkdown,
} from "../src/format/markdown.ts";
import type { WebFetchOutput, WebSearchOutput } from "../src/domain/types.ts";

describe("formatSearchMarkdown", () => {
  it("formats hits as compact citations with bounded excerpts", () => {
    const output: WebSearchOutput = {
      provider: "exa",
      query: "test",
      hits: [
        {
          title: "Result One",
          url: "https://example.com/one",
          publishedAt: "2026-04-01T12:00:00.000Z",
          author: "Author",
          highlights: ["First highlight"],
        },
      ],
    };
    const text = formatSearchMarkdown(output);
    expect(text).toContain("Title: Result One");
    expect(text).toContain("URL: https://example.com/one");
    expect(text).toContain("Published: 2026-04-01T12:00:00.000Z | Author: Author");
    expect(text).toContain("Excerpt: First highlight");
    expect(text).not.toContain("Highlights:");
  });

  it("separates multiple hits with ---", () => {
    const output: WebSearchOutput = {
      provider: "exa",
      query: "test",
      hits: [
        { title: "One", url: "https://example.com/one", highlights: ["a"] },
        { title: "Two", url: "https://example.com/two", highlights: ["b"] },
      ],
    };
    expect(formatSearchMarkdown(output)).toContain("---");
  });

  it("clips collapsed highlights but preserves expanded highlights", () => {
    const output: WebSearchOutput = {
      provider: "exa",
      query: "test",
      hits: [
        {
          title: "Long",
          url: "https://example.com/long",
          highlights: ["x".repeat(1_000)],
        },
      ],
    };

    const compactText = formatSearchMarkdown(output);
    const expandedText = formatSearchMarkdown(output, { expanded: true });
    expect(compactText.length).toBeLessThan(600);
    expect(compactText).toContain("…");
    expect(expandedText).toContain("x".repeat(1_000));
  });
});

describe("formatFetchMarkdown", () => {
  it("includes per-url errors in the text blob", () => {
    const output: WebFetchOutput = {
      provider: "exa",
      pages: [
        {
          url: "https://example.com/page",
          title: "Page",
          text: "Body",
        },
        {
          url: "https://example.com/missing",
          text: "",
          error: "not_found",
        },
      ],
    };
    const text = formatFetchMarkdown(output);
    expect(text).toContain("# Page");
    expect(text).toContain("Error fetching https://example.com/missing: not_found");
    expect(fetchHasSuccessfulContent(output)).toBe(true);
  });

  it("clips collapsed page text but preserves expanded page text", () => {
    const output: WebFetchOutput = {
      provider: "exa",
      pages: [
        {
          url: "https://example.com/page",
          title: "Page",
          text: "Body ".repeat(1_000),
        },
      ],
    };

    const compactText = formatFetchMarkdown(output);
    const expandedText = formatFetchMarkdown(output, { expanded: true });
    expect(compactText.length).toBeLessThan(2_000);
    expect(compactText).toContain("…");
    expect(expandedText).toContain("Body ".repeat(1_000).trim());
  });

  it("reports all failures for error helper", () => {
    const output: WebFetchOutput = {
      provider: "exa",
      pages: [{ url: "https://example.com/missing", text: "", error: "not_found" }],
    };
    expect(fetchHasSuccessfulContent(output)).toBe(false);
    expect(formatFetchAllErrors(output)).toContain("not_found");
  });
});
