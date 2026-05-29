import { defaultToolDiscoveryProvider } from "@executor-js/execution/core";
import type { PagedResult, ToolDiscoveryResult } from "@executor-js/execution/core";
import { Effect } from "effect";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadExecutorPiSettings } from "../config/store.ts";
import { createExecutorHost } from "../executor/index.ts";
import type { SearchMode } from "../schemas/settings.ts";
import { makeConfiguredSearchEmbeddingProvider } from "./embeddings.ts";
import { makeFtsToolDiscoveryProvider } from "./provider.ts";
import { openSearchStore } from "./store.ts";

interface EvalQuery {
  readonly id: string;
  readonly query: string;
  readonly namespace?: string;
}

interface SearchEvalOptions {
  readonly cwd: string;
  readonly modes: readonly SearchMode[];
  readonly limit: number;
  readonly offset: number;
  readonly outDir: string;
  readonly queries: readonly EvalQuery[];
  readonly rebuild: boolean;
  readonly reconcile: boolean;
}

interface EvalResult {
  readonly query: EvalQuery;
  readonly result: PagedResult<ToolDiscoveryResult>;
  readonly warning?: string;
}

interface ModeEvalResult {
  readonly mode: SearchMode;
  readonly indexStatus: string;
  readonly indexedTools: number;
  readonly indexedEmbeddings: number;
  readonly results: readonly EvalResult[];
}

class SearchEvalCliError extends Error {
  readonly _tag = "SearchEvalCliError";

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "SearchEvalCliError";
  }
}

const defaultQueries: readonly EvalQuery[] = [
  {
    id: "production-errors",
    query: "recent frontend backend production errors logs exceptions monitoring telemetry",
  },
  {
    id: "deployment-logs",
    query: "deployment build logs releases production deploy history CI",
  },
  {
    id: "github-regression",
    query: "GitHub issues pull requests commits regression history",
  },
  {
    id: "cloudflare-infra",
    query: "Cloudflare Pages Workers routes DNS zone settings deployments",
  },
  {
    id: "vendor-docs",
    query: "vendor documentation API reference web app behavior docs search",
  },
  {
    id: "sentry-errors",
    query: "Sentry recent production issues events releases suspect commits",
    namespace: "sentry",
  },
  {
    id: "posthog-errors",
    query: "PostHog error tracking issue events session recordings recent errors",
    namespace: "posthog",
  },
  {
    id: "cloudflare-pages",
    query: "Cloudflare Pages projects deployments deployment logs production branch",
    namespace: "cloudflare_api",
  },
  {
    id: "cloudflare-dns-routes",
    query: "Cloudflare DNS records zone settings rules routes workers domains",
    namespace: "cloudflare_api",
  },
  {
    id: "github-actions-logs",
    query: "GitHub Actions workflow run logs check runs failed build deployment",
    namespace: "github",
  },
];

const mutatingTerms = [
  "add",
  "apply",
  "approve",
  "batch",
  "cancel",
  "create",
  "delete",
  "disable",
  "dispatch",
  "edit",
  "enable",
  "import",
  "patch",
  "remove",
  "rerun",
  "retry",
  "rollback",
  "start",
  "trigger",
  "update",
  "upload",
] as const;

const readTerms = [
  "download",
  "export",
  "fetch",
  "find",
  "get",
  "inspect",
  "list",
  "query",
  "read",
  "retrieve",
  "search",
] as const;

const parseArgs = (argv: readonly string[]): SearchEvalOptions => {
  let cwd = process.cwd();
  let mode = "all";
  let limit = 10;
  let offset = 0;
  let outDir = ".scratchpad/research/search-evals";
  let query: string | undefined;
  let namespace: string | undefined;
  let rebuild = false;
  let reconcile = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };

    switch (arg) {
      case "--cwd":
        cwd = next();
        break;
      case "--mode":
        mode = next();
        break;
      case "--limit":
        limit = Number(next());
        break;
      case "--offset":
        offset = Number(next());
        break;
      case "--out-dir":
        outDir = next();
        break;
      case "--query":
        query = next();
        break;
      case "--namespace":
        namespace = next();
        break;
      case "--rebuild":
        rebuild = true;
        break;
      case "--reconcile":
        reconcile = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const modes =
    mode === "all"
      ? (["executor", "fts", "hybrid"] as const)
      : mode === "executor" || mode === "fts" || mode === "hybrid"
        ? ([mode] as const)
        : undefined;
  if (!modes) {
    throw new Error("--mode must be executor, fts, hybrid, or all");
  }
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--limit must be a positive number");
  }
  if (!Number.isFinite(offset) || offset < 0) {
    throw new Error("--offset must be a non-negative number");
  }

  return {
    cwd: resolve(cwd),
    modes,
    limit: Math.floor(limit),
    offset: Math.floor(offset),
    outDir: resolve(cwd, outDir),
    queries: query
      ? [
          {
            id: "ad-hoc",
            query,
            namespace,
          },
        ]
      : defaultQueries,
    rebuild,
    reconcile,
  };
};

const printHelp = (): void => {
  console.log(`Usage: bun run search:eval -- [options]

Options:
  --mode executor|fts|hybrid|all  Search mode to evaluate. Defaults to all.
  --cwd <path>                    Working directory/scope. Defaults to process cwd.
  --limit <n>                     Results per query. Defaults to 10.
  --offset <n>                    Search offset. Defaults to 0.
  --query <text>                  Run one ad-hoc query instead of the fixture suite.
  --namespace <name>              Namespace for --query.
  --reconcile                     Reconcile the index before indexed searches.
  --rebuild                       Force rebuild before indexed searches.
  --out-dir <path>                Output directory. Defaults to .scratchpad/research/search-evals.
`);
};

const hasMutatingSignal = (path: string): boolean => {
  const normalized = path.toLowerCase();
  return mutatingTerms.some((term) => normalized.includes(term));
};

const hasReadSignal = (path: string): boolean => {
  const normalized = path.toLowerCase();
  return readTerms.some((term) => normalized.includes(term));
};

const notesForItem = (item: ToolDiscoveryResult): string => {
  const notes = [];
  if (hasReadSignal(item.path)) notes.push("read-like");
  if (hasMutatingSignal(item.path)) notes.push("mutating?");
  return notes.join(", ");
};

const formatToolsInline = (items: readonly ToolDiscoveryResult[]): string =>
  items
    .slice(0, 5)
    .map((item) => `\`${item.path}\``)
    .join("<br>");

const markdownTableCell = (value: string | number): string =>
  String(value).replaceAll("\n", "<br>").replaceAll("|", "\\|");

const runSearch = (
  mode: SearchMode,
  options: SearchEvalOptions,
): Effect.Effect<ModeEvalResult, SearchEvalCliError> =>
  Effect.gen(function* () {
    const host = yield* createExecutorHost({
      cwd: options.cwd,
      searchModeOverride: mode,
    }).pipe(Effect.mapError((cause) => new SearchEvalCliError(cause.message, { cause })));

    try {
      if (mode !== "executor" && options.rebuild) {
        yield* host
          .rebuildSearchIndex()
          .pipe(Effect.mapError((cause) => new SearchEvalCliError(cause.message, { cause })));
      } else if (mode !== "executor" && options.reconcile) {
        yield* host
          .reconcileSearchIndex()
          .pipe(Effect.mapError((cause) => new SearchEvalCliError(cause.message, { cause })));
      }

      const settings = yield* loadExecutorPiSettings(host.scopeDir);
      const effectiveSettings = {
        ...settings,
        search: { ...settings.search, mode },
      };
      const embeddingProvider = makeConfiguredSearchEmbeddingProvider(
        effectiveSettings.search.embeddings,
      );
      const warning =
        mode === "hybrid" && embeddingProvider === null
          ? "Hybrid mode has no embedding provider configured; results fall back to FTS."
          : undefined;

      const searchStore =
        mode === "executor"
          ? null
          : openSearchStore(host.searchSqlitePath, {
              embeddingDimensions: embeddingProvider?.dimensions,
            });

      try {
        const provider =
          mode === "executor"
            ? defaultToolDiscoveryProvider
            : makeFtsToolDiscoveryProvider(searchStore!, {
                hybrid: mode === "hybrid" && embeddingProvider !== null,
                embeddingProvider: embeddingProvider ?? undefined,
              });
        const results = yield* Effect.all(
          options.queries.map((query) =>
            provider
              .searchTools({
                executor: host.executor,
                query: query.query,
                namespace: query.namespace,
                limit: options.limit,
                offset: options.offset,
              })
              .pipe(Effect.map((result) => ({ query, result, warning }))),
          ),
          { concurrency: 1 },
        ).pipe(Effect.mapError((cause) => new SearchEvalCliError(cause.message, { cause })));

        return {
          mode,
          indexStatus: host.searchIndexStatus.status,
          indexedTools: host.searchIndexStatus.documentCount,
          indexedEmbeddings: host.searchIndexStatus.embeddingCount,
          results,
        } satisfies ModeEvalResult;
      } finally {
        searchStore?.close();
      }
    } finally {
      yield* host.close().pipe(Effect.orElseSucceed(() => undefined));
    }
  });

const renderMarkdown = (
  options: SearchEvalOptions,
  modeResults: readonly ModeEvalResult[],
  timestamp: string,
): string => {
  const lines = [
    `# PiExecutor Search Eval ${timestamp}`,
    "",
    `- cwd: \`${options.cwd}\``,
    `- modes: ${modeResults.map((result) => `\`${result.mode}\``).join(", ")}`,
    `- limit: ${options.limit}`,
    `- offset: ${options.offset}`,
    `- rebuild: ${options.rebuild ? "yes" : "no"}`,
    `- reconcile: ${options.reconcile ? "yes" : "no"}`,
    "",
    "## Mode Status",
    "",
    "| Mode | Index status | Indexed tools | Indexed embeddings |",
    "| --- | --- | ---: | ---: |",
    ...modeResults.map(
      (result) =>
        `| ${result.mode} | ${result.indexStatus} | ${result.indexedTools} | ${result.indexedEmbeddings} |`,
    ),
    "",
    "## Comparison",
    "",
    "| Query | Namespace | Mode | Total | Top results | Notes |",
    "| --- | --- | --- | ---: | --- | --- |",
  ];

  for (const query of options.queries) {
    for (const modeResult of modeResults) {
      const evalResult = modeResult.results.find((result) => result.query.id === query.id);
      const items = evalResult?.result.items ?? [];
      const suspicious = items
        .slice(0, 5)
        .filter((item) => hasMutatingSignal(item.path))
        .map((item) => `mutating high: \`${item.path}\``);
      const notes = [...(evalResult?.warning ? [evalResult.warning] : []), ...suspicious].join(
        "<br>",
      );
      lines.push(
        [
          markdownTableCell(query.query),
          markdownTableCell(query.namespace ?? ""),
          markdownTableCell(modeResult.mode),
          markdownTableCell(evalResult?.result.total ?? 0),
          markdownTableCell(formatToolsInline(items)),
          markdownTableCell(notes),
        ]
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      );
    }
  }

  lines.push("", "## Per-Mode Details", "");
  for (const modeResult of modeResults) {
    lines.push(`### ${modeResult.mode}`, "");
    for (const evalResult of modeResult.results) {
      lines.push(
        `#### ${evalResult.query.id}`,
        "",
        `Query: \`${evalResult.query.query}\``,
        evalResult.query.namespace ? `Namespace: \`${evalResult.query.namespace}\`` : "",
        `Total: ${evalResult.result.total}`,
        "",
        "| Rank | Tool | Source | Score | Notes |",
        "| ---: | --- | --- | ---: | --- |",
      );
      evalResult.result.items.forEach((item, index) => {
        lines.push(
          `| ${index + 1} | \`${markdownTableCell(item.path)}\` | ${markdownTableCell(
            item.sourceId,
          )} | ${item.score} | ${markdownTableCell(notesForItem(item))} |`,
        );
      });
      lines.push("");
    }
  }

  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
};

const writeReports = (
  options: SearchEvalOptions,
  modeResults: readonly ModeEvalResult[],
): { readonly markdownPath: string; readonly jsonPath: string } => {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z");
  const modeSlug =
    modeResults.length === 1
      ? modeResults[0]!.mode
      : modeResults.map((result) => result.mode).join("-");
  const basename = `${timestamp}-${modeSlug}`;
  if (!existsSync(options.outDir)) {
    mkdirSync(options.outDir, { recursive: true });
  }

  const markdownPath = join(options.outDir, `${basename}.md`);
  const jsonPath = join(options.outDir, `${basename}.json`);
  const markdown = renderMarkdown(options, modeResults, timestamp);
  const payload = {
    timestamp,
    options,
    modes: modeResults,
  };
  writeFileSync(markdownPath, `${markdown}\n`, "utf-8");
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return { markdownPath, jsonPath };
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  options.modes.forEach((mode) => console.log(`search:eval ${mode}...`));
  const modeResults = await Effect.runPromise(
    Effect.all(
      options.modes.map((mode) => runSearch(mode, options)),
      { concurrency: 1 },
    ),
  );
  const { markdownPath, jsonPath } = writeReports(options, modeResults);
  console.log(`Markdown: ${markdownPath}`);
  console.log(`JSON: ${jsonPath}`);
};

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const lines = [error.stack ?? error.message];
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    lines.push("Caused by:", cause.stack ?? cause.message);
    cause = cause.cause;
  }
  if (cause !== undefined) {
    lines.push("Caused by:", String(cause));
  }
  return lines.join("\n");
}
