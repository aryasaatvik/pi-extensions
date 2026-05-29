import type { WebFetchOutput, WebSearchHit, WebSearchOutput } from "../domain/types.ts";

const collapsedSearchHits = 5;
const searchExcerptCharacters = 240;
const fetchExcerptCharacters = 900;

type FormatOptions = {
  readonly expanded?: boolean;
};

const compactWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

const truncate = (text: string, maxCharacters: number): string => {
  const compacted = compactWhitespace(text);
  if (compacted.length <= maxCharacters) {
    return compacted;
  }
  return `${compacted.slice(0, maxCharacters - 1).trimEnd()}…`;
};

const hitExcerpt = (hit: WebSearchHit, options: FormatOptions): string | undefined => {
  const source =
    hit.highlights && hit.highlights.length > 0
      ? hit.highlights.join(" ")
      : hit.text
        ? hit.text
        : undefined;
  if (!source) {
    return undefined;
  }
  return options.expanded ? source.trim() : truncate(source, searchExcerptCharacters);
};

const formatSearchHit = (hit: WebSearchHit, options: FormatOptions): string => {
  const lines = [`Title: ${hit.title || "N/A"}`, `URL: ${hit.url}`];
  const metadata = [
    hit.publishedAt ? `Published: ${hit.publishedAt}` : undefined,
    hit.author ? `Author: ${hit.author}` : undefined,
  ].filter((item): item is string => item !== undefined);
  if (metadata.length > 0) {
    lines.push(metadata.join(" | "));
  }
  const excerpt = hitExcerpt(hit, options);
  if (excerpt) {
    lines.push(`Excerpt: ${excerpt}`);
  }
  return lines.join("\n");
};

export const formatSearchMarkdown = (
  output: WebSearchOutput,
  options: FormatOptions = {},
): string => {
  if (output.hits.length === 0) {
    return "No search results found. Please try a different query.";
  }
  const hits = options.expanded ? output.hits : output.hits.slice(0, collapsedSearchHits);
  const entries = hits.map((hit) => formatSearchHit(hit, options));
  const omitted = output.hits.length - hits.length;
  if (omitted > 0) {
    entries.push(`${omitted} more result(s) hidden in collapsed view.`);
  }
  return entries.join("\n\n---\n\n");
};

export const formatFetchMarkdown = (
  output: WebFetchOutput,
  options: FormatOptions = {},
): string => {
  if (output.pages.length === 0) {
    return "No content found for the provided URL(s).";
  }

  const entries: string[] = [];
  for (const page of output.pages) {
    if (page.error) {
      entries.push(`Error fetching ${page.url}: ${page.error}`);
      continue;
    }
    const lines: string[] = [];
    lines.push(`# ${page.title || "(no title)"}`);
    lines.push(`URL: ${page.url}`);
    if (page.publishedAt) {
      lines.push(`Published: ${page.publishedAt}`);
    }
    if (page.author) {
      lines.push(`Author: ${page.author}`);
    }
    lines.push("");
    if (page.text) {
      lines.push(options.expanded ? page.text.trim() : truncate(page.text, fetchExcerptCharacters));
    }
    entries.push(lines.join("\n").trim());
  }

  return entries.join("\n\n---\n\n");
};

export const fetchHasSuccessfulContent = (output: WebFetchOutput): boolean =>
  output.pages.some((page) => !page.error && page.text.length > 0);

export const formatFetchAllErrors = (output: WebFetchOutput): string => {
  const errors = output.pages.filter((page) => page.error);
  if (errors.length === 0) {
    return "No content found for the provided URL(s).";
  }
  return `Error fetching URL(s): ${errors.map((page) => `${page.url}: ${page.error}`).join("; ")}`;
};
