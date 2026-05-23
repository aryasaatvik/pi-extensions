import { highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Context, Effect, Layer } from "effect";

import type { ExecuteDetails, ExecuteInput } from "../schemas/execute.ts";
import type { SearchDetails, SearchInput } from "../schemas/search.ts";

const maxPreviewChars = 4_000;

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";

  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
};

const truncate = (value: string, limit = maxPreviewChars): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}\n... truncated`;

const firstLine = (value: string): string => value.split("\n").find((line) => line.trim()) ?? "";

const renderLogs = (logs: readonly string[], theme: Theme): string[] => {
  if (logs.length === 0) return [];

  return [
    "",
    theme.fg("muted", "Logs"),
    ...logs.flatMap((entry) => entry.split("\n")).map((line) => theme.fg("dim", line)),
  ];
};

export const renderExecuteCall = (args: ExecuteInput, theme: Theme): Text => {
  const highlighted = highlightCode(args.code.trim(), "typescript");
  const lines = [
    theme.fg("toolTitle", theme.bold("Executor")),
    ...highlighted.map((line) => `  ${line}`),
  ];

  return new Text(lines.join("\n"), 0, 0);
};

export const renderExecuteResult = (
  details: ExecuteDetails | undefined,
  contentText: string,
  options: { readonly expanded?: boolean; readonly isPartial?: boolean },
  theme: Theme,
): Text => {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "Executor running..."), 0, 0);
  }

  if (!details) {
    return new Text(truncate(contentText), 0, 0);
  }

  if (details.status === "error") {
    const lines = [
      theme.fg("error", theme.bold("Executor failed")),
      theme.fg("error", details.error),
      ...(options.expanded ? renderLogs(details.logs, theme) : []),
    ];
    return new Text(lines.join("\n"), 0, 0);
  }

  const result = stringify(details.result);
  const summary = firstLine(result) || "(no result)";
  const lines = [
    theme.fg("success", theme.bold("Executor completed")),
    theme.fg("toolOutput", options.expanded ? truncate(result) : truncate(summary, 240)),
    ...(options.expanded ? renderLogs(details.logs, theme) : []),
  ];

  if (!options.expanded && details.logs.length > 0) {
    lines.push(theme.fg("dim", `${details.logs.length} log line(s)`));
  }

  return new Text(lines.join("\n"), 0, 0);
};

export const renderSearchCall = (args: SearchInput, theme: Theme): Text => {
  const suffix = [
    args.namespace ? `namespace=${args.namespace}` : undefined,
    args.limit ? `limit=${args.limit}` : undefined,
    args.offset ? `offset=${args.offset}` : undefined,
    args.includeDetails ? "details" : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
  const lines = [
    theme.fg("toolTitle", theme.bold("Search")),
    theme.fg("toolOutput", args.query),
    ...(suffix ? [theme.fg("dim", suffix)] : []),
  ];

  return new Text(lines.join("\n"), 0, 0);
};

export const renderSearchResult = (
  details: SearchDetails | undefined,
  contentText: string,
  options: { readonly expanded?: boolean; readonly isPartial?: boolean },
  theme: Theme,
): Text => {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "Search running..."), 0, 0);
  }

  if (!details) {
    return new Text(truncate(contentText), 0, 0);
  }

  const lines = [
    theme.fg("success", theme.bold(`Search found ${details.total} result(s)`)),
    ...details.items.map((item) => {
      const summary = item.description ? ` - ${item.description}` : "";
      return theme.fg("toolOutput", `${item.path}${summary}`);
    }),
  ];

  if (details.hasMore && details.nextOffset !== null) {
    lines.push(theme.fg("dim", `More results at offset ${details.nextOffset}`));
  }

  if (options.expanded) {
    lines.push("", theme.fg("muted", "JSON"), truncate(stringify(details)));
  }

  return new Text(lines.join("\n"), 0, 0);
};

export class RenderService extends Context.Service<
  RenderService,
  {
    readonly summarize: (value: unknown) => Effect.Effect<string>;
    readonly formatJson: (value: unknown) => Effect.Effect<string>;
  }
>()("RenderService") {
  static readonly Default = Layer.succeed(this)({
    summarize: (value) =>
      Effect.sync(() => {
        return truncate(stringify(value));
      }),
    formatJson: (value) => Effect.sync(() => stringify(value)),
  });
}
