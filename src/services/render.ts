import { highlightCode, keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Context, Effect, Layer } from "effect";

import type { ExecuteDetails, ExecuteInput } from "../schemas/execute.ts";
import type { SearchDetails, SearchInput } from "../schemas/search.ts";
import type { RenderSettings } from "../schemas/settings.ts";
import { ConfigService } from "./config.ts";

const maxSearchSnippetChars = 120;
const maxCollapsedOutputChars = 1_200;

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";

  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
};

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}\n... truncated`;

const truncateLines = (value: string, limit: number): string => {
  const lines = value.split("\n");
  if (lines.length <= limit) return value;
  return [...lines.slice(0, limit), `... truncated ${lines.length - limit} line(s)`].join("\n");
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const firstParagraph = (value: string): string =>
  value.split(/\n\s*\n/).find((part) => part.trim()) ?? value;

const truncateLine = (value: string, limit: number): string => {
  const collapsed = collapseWhitespace(value);
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
};

const indentedLines = (value: string, theme: Theme, prefix = "  "): string[] =>
  value
    .trim()
    .split("\n")
    .map((line) => theme.fg("dim", `${prefix}${line}`));

const formatSources = (details: SearchDetails): string => {
  const sources = [...new Set(details.items.map((item) => item.sourceId))].sort();
  return sources.length === 0 ? "none" : sources.join(", ");
};

const formatSearchItem = (
  item: SearchDetails["items"][number],
  options: { readonly expanded?: boolean },
  theme: Theme,
): string[] => {
  const description = item.details?.description ?? item.description;
  const lines = [`${theme.fg("toolOutput", item.path)} ${theme.fg("dim", `[${item.sourceId}]`)}`];

  if (description) {
    const renderedDescription = options.expanded
      ? description.trim()
      : truncateLine(firstParagraph(description), maxSearchSnippetChars);
    lines.push(...indentedLines(renderedDescription, theme));
  }

  if (options.expanded && item.details) {
    if (item.details.inputTypeScript) {
      lines.push(theme.fg("muted", "  Input"));
      lines.push(...indentedLines(item.details.inputTypeScript, theme, "    "));
    }
    if (item.details.outputTypeScript) {
      lines.push(theme.fg("muted", "  Output"));
      lines.push(...indentedLines(item.details.outputTypeScript, theme, "    "));
    }
  }

  return lines;
};

const sectionLabel = (label: string, theme: Theme): string => theme.fg("muted", theme.bold(label));

const highlightJson = (value: string): string[] => highlightCode(value, "json");

const formatExecuteOutput = (
  value: unknown,
  options: { readonly expanded?: boolean },
  theme: Theme,
  settings: RenderSettings,
): string[] => {
  const formatted = stringify(value);
  const truncated = truncate(
    formatted,
    options.expanded
      ? settings.maxJsonBytes
      : Math.min(settings.maxJsonBytes, maxCollapsedOutputChars),
  );

  return highlightJson(truncated).map((line) => theme.fg("toolOutput", line));
};

const formatExecuteLogs = (
  logs: readonly string[],
  options: { readonly expanded?: boolean },
  theme: Theme,
  settings: RenderSettings,
): string[] => {
  if (logs.length === 0) {
    return [theme.fg("dim", "Logs: none")];
  }

  const logLines = logs.flatMap((entry) => entry.split("\n"));
  const visibleLimit = options.expanded ? settings.maxLogLines : Math.min(settings.maxLogLines, 6);
  const visibleLogs = logLines.slice(0, visibleLimit);
  const remaining = logLines.length - visibleLogs.length;

  return [
    sectionLabel("Logs", theme),
    ...visibleLogs.map((line) => theme.fg("dim", line)),
    ...(remaining > 0 ? [theme.fg("dim", `... ${remaining} more log line(s)`)] : []),
  ];
};

const renderExecuteCallWithSettings = (
  args: ExecuteInput,
  theme: Theme,
  settings: RenderSettings,
): Text => {
  const highlighted = highlightCode(
    truncateLines(args.code.trim(), settings.maxCodePreviewLines),
    "typescript",
  );
  return new Text([sectionLabel("Code", theme), ...highlighted].join("\n"), 0, 0);
};

const renderExecuteResultWithSettings = (
  details: ExecuteDetails | undefined,
  contentText: string,
  options: { readonly expanded?: boolean; readonly isPartial?: boolean },
  theme: Theme,
  settings: RenderSettings,
): Text => {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "running..."), 0, 0);
  }

  if (!details) {
    return new Text(truncate(contentText, settings.maxJsonBytes), 0, 0);
  }

  if (details.status === "error") {
    const lines = [
      theme.fg("error", theme.bold("failed")),
      theme.fg("error", details.error),
      "",
      ...formatExecuteLogs(details.logs, options, theme, settings),
    ];
    return new Text(lines.join("\n"), 0, 0);
  }

  const lines = [
    sectionLabel("Output", theme),
    ...formatExecuteOutput(details.result, options, theme, settings),
    "",
    ...formatExecuteLogs(details.logs, options, theme, settings),
  ];

  return new Text(lines.join("\n"), 0, 0);
};

const renderSearchCallWithSettings = (args: SearchInput, theme: Theme): Text => {
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

const renderSearchResultWithSettings = (
  details: SearchDetails | undefined,
  contentText: string,
  options: { readonly expanded?: boolean; readonly isPartial?: boolean },
  theme: Theme,
  settings: RenderSettings,
  search: { readonly showSourcesFooter: boolean },
): Text => {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "Search running..."), 0, 0);
  }

  if (!details) {
    return new Text(truncate(contentText, settings.maxJsonBytes), 0, 0);
  }

  const lines = [
    theme.fg("success", theme.bold(`${details.total} result(s)`)),
    sectionLabel("Tools", theme),
    ...details.items.flatMap((item) => formatSearchItem(item, options, theme)),
  ];

  if (details.hasMore && details.nextOffset !== null) {
    lines.push(theme.fg("dim", `More results at offset ${details.nextOffset}`));
  }

  if (!options.expanded) {
    const hasExpandedContent = details.items.some(
      (item) =>
        item.details?.description !== undefined ||
        item.details?.inputTypeScript !== undefined ||
        item.details?.outputTypeScript !== undefined ||
        item.details?.typeScriptDefinitions !== undefined,
    );
    if (hasExpandedContent) {
      lines.push(theme.fg("muted", `${keyText("app.tools.expand")} to expand descriptions`));
    }
  }

  if (search.showSourcesFooter) {
    lines.push("", sectionLabel("Sources", theme), theme.fg("dim", formatSources(details)));
  }

  return new Text(lines.join("\n"), 0, 0);
};

export class RenderService extends Context.Service<
  RenderService,
  {
    readonly renderExecuteCall: (
      cwd: string,
      args: ExecuteInput,
      theme: Theme,
    ) => Effect.Effect<Text>;
    readonly renderExecuteResult: (
      cwd: string,
      details: ExecuteDetails | undefined,
      contentText: string,
      options: { readonly expanded?: boolean; readonly isPartial?: boolean },
      theme: Theme,
    ) => Effect.Effect<Text>;
    readonly renderSearchCall: (
      cwd: string,
      args: SearchInput,
      theme: Theme,
    ) => Effect.Effect<Text>;
    readonly renderSearchResult: (
      cwd: string,
      details: SearchDetails | undefined,
      contentText: string,
      options: { readonly expanded?: boolean; readonly isPartial?: boolean },
      theme: Theme,
    ) => Effect.Effect<Text>;
  }
>()("RenderService") {
  static readonly Default = Layer.effect(this)(
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const resolveSettings = (cwd: string) =>
        config.resolve(cwd).pipe(Effect.map((resolved) => resolved.settings));

      return {
        renderExecuteCall: (cwd, args, theme) =>
          resolveSettings(cwd).pipe(
            Effect.map((settings) => renderExecuteCallWithSettings(args, theme, settings.render)),
          ),
        renderExecuteResult: (cwd, details, contentText, options, theme) =>
          resolveSettings(cwd).pipe(
            Effect.map((settings) =>
              renderExecuteResultWithSettings(
                details,
                contentText,
                options,
                theme,
                settings.render,
              ),
            ),
          ),
        renderSearchCall: (_cwd, args, theme) =>
          Effect.succeed(renderSearchCallWithSettings(args, theme)),
        renderSearchResult: (cwd, details, contentText, options, theme) =>
          resolveSettings(cwd).pipe(
            Effect.map((settings) =>
              renderSearchResultWithSettings(
                details,
                contentText,
                options,
                theme,
                settings.render,
                settings.search,
              ),
            ),
          ),
      };
    }),
  );
}
