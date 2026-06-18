import { describe, expect, it } from "@effect/vitest";
import {
  createExecutionEngine,
  defaultToolDiscoveryProvider,
  type ToolDiscoveryProvider,
} from "@executor-js/execution";
import { Effect } from "effect";

describe("Executor tool discovery provider patch", () => {
  type EngineConfig = Parameters<typeof createExecutionEngine>[0];

  it("lets Pi pass a custom provider into execution engine config", () => {
    const provider = {
      searchTools: () =>
        Effect.succeed({
          items: [],
          total: 0,
          hasMore: false,
          nextOffset: null,
        }),
    } satisfies ToolDiscoveryProvider;

    const config = {
      executor: {} as EngineConfig["executor"],
      codeExecutor: {} as EngineConfig["codeExecutor"],
      toolDiscoveryProvider: provider,
    } satisfies EngineConfig;

    expect(config.toolDiscoveryProvider).toBe(provider);
    expect(defaultToolDiscoveryProvider.searchTools).toEqual(expect.any(Function));
  });

  it.effect("routes sandbox tools.search through the custom provider", () =>
    Effect.gen(function* () {
      const calls: Array<{
        readonly query: string;
        readonly namespace?: string;
        readonly limit: number;
        readonly offset: number;
      }> = [];
      const provider = {
        searchTools: ({ query, namespace, limit, offset }) =>
          Effect.sync(() => {
            calls.push({ query, namespace, limit, offset });
            return {
              items: [
                {
                  path: "custom.result",
                  name: "result",
                  description: "Provided by Pi",
                  integration: "custom",
                  score: 42,
                },
              ],
              total: 1,
              hasMore: false,
              nextOffset: null,
            };
          }),
      } satisfies ToolDiscoveryProvider;
      const codeExecutor = {
        execute: (_code, invoker) =>
          invoker
            .invoke({
              path: "search",
              args: {
                query: "calendar events",
                namespace: "calendar",
                limit: 7,
                offset: 2,
              },
            })
            .pipe(
              Effect.map((result) => ({ result, logs: [] })),
              Effect.orDie,
            ),
      } satisfies EngineConfig["codeExecutor"];
      const engine = createExecutionEngine({
        executor: {} as EngineConfig["executor"],
        codeExecutor,
        toolDiscoveryProvider: provider,
      });

      const result = yield* engine.execute("return await tools.search(...)", {
        onElicitation: () => Effect.succeed({ action: "cancel" as const }),
      });

      expect(result.result).toEqual({
        items: [
          {
            path: "custom.result",
            name: "result",
            description: "Provided by Pi",
            integration: "custom",
            score: 42,
          },
        ],
        total: 1,
        hasMore: false,
        nextOffset: null,
      });
      expect(calls).toEqual([
        {
          query: "calendar events",
          namespace: "calendar",
          limit: 7,
          offset: 2,
        },
      ]);
    }),
  );
});
