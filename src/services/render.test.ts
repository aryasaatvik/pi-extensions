import type { Theme } from "@earendil-works/pi-coding-agent";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import type { ExecuteDetails } from "../schemas/execute.ts";
import type { SearchDetails } from "../schemas/search.ts";
import { type ExecutorSettings, DefaultExecutorSettings } from "../schemas/settings.ts";
import { ConfigService } from "./config.ts";
import { RenderService } from "./render.ts";

const theme = {
  bold: (value: string) => value,
  fg: (color: string, value: string) => value,
} as Theme;

const renderText = (text: { render: (width: number) => string[] }): string =>
  text.render(220).join("\n");

const mockConfigService = (settings: ExecutorSettings) =>
  Layer.succeed(ConfigService)({
    resolve: (cwd) => Effect.succeed({ cwd, settings }),
    saveGlobal: () => Effect.void,
    saveProject: () => Effect.void,
    formatSettingsSummary: () => "",
    formatStatusBar: () => "executor: test",
  });

const renderLayer = (settings: ExecutorSettings) =>
  RenderService.Default.pipe(Layer.provideMerge(mockConfigService(settings)));

const runRender = <A>(effect: Effect.Effect<A, never, RenderService>): A =>
  Effect.runSync(effect.pipe(Effect.provide(renderLayer(DefaultExecutorSettings))));

const runRenderWithSettings = <A>(
  settings: ExecutorSettings,
  effect: Effect.Effect<A, never, RenderService>,
): A => Effect.runSync(effect.pipe(Effect.provide(renderLayer(settings))));

describe("renderSearchResult", () => {
  it("hides the sources footer when disabled", () => {
    const details: SearchDetails = {
      total: 1,
      hasMore: false,
      nextOffset: null,
      items: [
        {
          path: "tools.github.search",
          name: "search",
          description: "Search GitHub",
          sourceId: "github",
          score: 1,
        },
      ],
    };

    const text = runRenderWithSettings(
      {
        ...DefaultExecutorSettings,
        search: { ...DefaultExecutorSettings.search, showSourcesFooter: false },
      },
      Effect.flatMap(RenderService.asEffect(), (render) =>
        render.renderSearchResult("/tmp", details, "", {}, theme),
      ),
    );

    expect(text).not.toContain("Sources");
  });

  it("renders compact snippets and a source footer", () => {
    const details: SearchDetails = {
      total: 29,
      hasMore: true,
      nextOffset: 3,
      items: [
        {
          path: "posthog.query_error_tracking_issues_list",
          name: "query_error_tracking_issues_list",
          sourceId: "posthog",
          score: 1,
          description:
            "List and filter Error tracking issues. Returns compact issue rows with aggregate impact counts and optional volume buckets.\n\nUse this first when the user asks which errors are happening.",
        },
        {
          path: "sentry.search_issues",
          name: "search_issues",
          sourceId: "sentry",
          score: 0.9,
          details: {
            path: "sentry.search_issues",
            name: "search_issues",
            description:
              "Search for grouped issues/problems in Sentry - returns a LIST of issues, NOT counts or aggregations.\n\nProvide query as natural language or Sentry issue search syntax.",
            inputTypeScript: "type Input = { organizationSlug: string; query: string }",
            outputTypeScript: "type Output = { issues: Array<{ id: string; title: string }> }",
          },
        },
      ],
    };

    const output = renderText(
      runRender(
        Effect.flatMap(RenderService.asEffect(), (render) =>
          render.renderSearchResult("/tmp/project", details, "", { expanded: false }, theme),
        ),
      ),
    );

    expect(output).toContain("29 result(s)");
    expect(output).toContain("Tools");
    expect(output).toContain("posthog.query_error_tracking_issues_list");
    expect(output).toContain("[posthog]");
    expect(output).toContain("sentry.search_issues");
    expect(output).toContain("Sources");
    expect(output).toContain("posthog, sentry");
    expect(output).toContain("More results at offset 3");
    expect(output).toContain("to expand descriptions");
    expect(output).not.toContain("Use this first when the user asks");
    expect(output).not.toContain("type Input =");
  });

  it("renders full descriptions and type details when expanded", () => {
    const details: SearchDetails = {
      total: 1,
      hasMore: false,
      nextOffset: null,
      items: [
        {
          path: "sentry.search_issues",
          name: "search_issues",
          sourceId: "sentry",
          score: 0.9,
          details: {
            path: "sentry.search_issues",
            name: "search_issues",
            description:
              "Search for grouped issues/problems in Sentry - returns a LIST of issues, NOT counts or aggregations.\n\nProvide query as natural language or Sentry issue search syntax.",
            inputTypeScript: "type Input = { organizationSlug: string; query: string }",
            outputTypeScript: "type Output = { issues: Array<{ id: string; title: string }> }",
          },
        },
      ],
    };

    const output = renderText(
      runRender(
        Effect.flatMap(RenderService.asEffect(), (render) =>
          render.renderSearchResult("/tmp/project", details, "", { expanded: true }, theme),
        ),
      ),
    );

    expect(output).toContain("Provide query as natural language");
    expect(output).toContain("Input");
    expect(output).toContain("type Input =");
    expect(output).toContain("Output");
    expect(output).toContain("type Output =");
    expect(output).not.toContain("to expand descriptions");
  });
});

describe("renderExecuteResult", () => {
  it("renders code, pretty structured output, and log state without completion chrome", () => {
    const details: ExecuteDetails = {
      status: "completed",
      result: { value: 3, source: "executor-pi-dogfood" },
      logs: [],
    };

    const callOutput = renderText(
      runRender(
        Effect.flatMap(RenderService.asEffect(), (render) =>
          render.renderExecuteCall(
            "/tmp/project",
            { code: "return { value: 1 + 2, source: 'executor-pi-dogfood' };" },
            theme,
          ),
        ),
      ),
    );
    const output = renderText(
      runRender(
        Effect.flatMap(RenderService.asEffect(), (render) =>
          render.renderExecuteResult("/tmp/project", details, "", { expanded: false }, theme),
        ),
      ),
    );

    expect(callOutput).toContain("Code");
    expect(output).toContain("Output");
    expect(output).toContain('"value": 3');
    expect(output).toContain('"source": "executor-pi-dogfood"');
    expect(output).toContain("Logs: none");
    expect(output).not.toContain("Executor completed");
  });

  it("applies configured render limits", () => {
    const settings: ExecutorSettings = {
      ...DefaultExecutorSettings,
      displayMode: "custom",
      render: {
        maxCodePreviewLines: 1,
        maxJsonBytes: 20,
        maxLogLines: 1,
      },
    };
    const details: ExecuteDetails = {
      status: "completed",
      result: { value: "abcdefghijklmnopqrstuvwxyz" },
      logs: ["first\nsecond"],
    };

    const callOutput = renderText(
      runRenderWithSettings(
        settings,
        Effect.flatMap(RenderService.asEffect(), (render) =>
          render.renderExecuteCall("/tmp/project", { code: "const x = 1;\nreturn x;" }, theme),
        ),
      ),
    );
    const output = renderText(
      runRenderWithSettings(
        settings,
        Effect.flatMap(RenderService.asEffect(), (render) =>
          render.renderExecuteResult("/tmp/project", details, "", { expanded: true }, theme),
        ),
      ),
    );

    expect(callOutput).toContain("... truncated 1 line(s)");
    expect(output).toContain("... truncated");
    expect(output).toContain("first");
    expect(output).toContain("... 1 more log line(s)");
    expect(output).not.toContain("second");
  });
});
