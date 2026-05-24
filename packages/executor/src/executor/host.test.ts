import { afterEach, describe, expect, it } from "@effect/vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";

import { ExecutorHostService } from "../services/executor-host.ts";
import { createExecutorHost } from "./host.ts";
import { loadExecutorPlugins } from "./plugin-config.ts";
import { resolveExecutorScope } from "./scope.ts";

interface Fixture {
  readonly workspace: string;
  readonly projectDir: string;
  readonly dataDir: string;
  readonly previousDataDir: string | undefined;
}

const fixtures = new Set<Fixture>();

const makeFixture = (): Fixture => {
  const workspace = mkdtempSync(join(tmpdir(), "executor-pi-host-test-"));
  const projectDir = join(workspace, "project");
  const dataDir = join(workspace, "data");
  const previousDataDir = process.env.EXECUTOR_DATA_DIR;

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  process.env.EXECUTOR_DATA_DIR = dataDir;

  const fixture = {
    workspace,
    projectDir,
    dataDir,
    previousDataDir,
  } satisfies Fixture;
  fixtures.add(fixture);
  return fixture;
};

const cleanupFixture = (fixture: Fixture): void => {
  fixtures.delete(fixture);

  if (fixture.previousDataDir === undefined) {
    delete process.env.EXECUTOR_DATA_DIR;
  } else {
    process.env.EXECUTOR_DATA_DIR = fixture.previousDataDir;
  }

  rmSync(fixture.workspace, { recursive: true, force: true });
};

const withFixture = <A, E, R>(
  run: (fixture: Fixture) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(Effect.sync(makeFixture), run, (fixture) =>
    Effect.sync(() => cleanupFixture(fixture)),
  );

const silenceExpectedDuplicateWarning = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const warn = console.warn;
      console.warn = (message?: unknown, ...args: ReadonlyArray<unknown>) => {
        if (
          typeof message === "string" &&
          message.includes('plugin "@executor-js/plugin-mcp" appears in both static config')
        ) {
          return;
        }

        warn(message, ...args);
      };
      return warn;
    }),
    () => effect,
    (warn) =>
      Effect.sync(() => {
        console.warn = warn;
      }),
  );

const writeFixturePackage = (
  root: string,
  name: string,
  packageName: string,
  pluginPackageName = packageName,
): void => {
  const packageDir = join(root, "node_modules", "@executor-pi-fixture", name);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify(
      {
        name: packageName,
        version: "0.0.0",
        private: true,
        type: "module",
        exports: {
          "./server": "./server.js",
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(packageDir, "server.js"),
    `export default () => ({
  id: "${name}",
  packageName: "${pluginPackageName}",
  storage: () => ({}),
  staticSources: () => [],
});
`,
  );
};

const writeProjectConfig = (fixture: Fixture): void => {
  writeFixturePackage(
    fixture.projectDir,
    "dynamic",
    "@executor-pi-fixture/dynamic",
    "@executor-pi-fixture/dynamic",
  );
  writeFixturePackage(
    fixture.projectDir,
    "mcp-shadow",
    "@executor-pi-fixture/mcp-shadow",
    "@executor-js/plugin-mcp",
  );
  writeFileSync(
    join(fixture.projectDir, "executor.jsonc"),
    JSON.stringify(
      {
        plugins: [
          { package: "@executor-pi-fixture/dynamic" },
          { package: "@executor-pi-fixture/mcp-shadow" },
        ],
      },
      null,
      2,
    ),
  );
};

afterEach(() => {
  for (const fixture of fixtures) {
    cleanupFixture(fixture);
  }
});

describe.sequential("Executor host contract", () => {
  it("resolves stable cwd-derived scope ids", () => {
    const scope = resolveExecutorScope("/tmp/project");

    expect(scope.scopeDir).toBe(resolve("/tmp/project"));
    expect(scope.scopeId).toMatch(/^project-[0-9a-f]{8}$/);
  });

  it.effect("loads executor.jsonc plugins after static plugins and dedupes static packages", () =>
    withFixture((fixture) =>
      silenceExpectedDuplicateWarning(
        Effect.gen(function* () {
          writeProjectConfig(fixture);

          const loaded = yield* loadExecutorPlugins(fixture.projectDir);
          const packageNames = loaded.plugins.map((plugin) => plugin.packageName ?? plugin.id);

          expect(packageNames).toContain("@executor-pi-fixture/dynamic");
          expect(packageNames.filter((name) => name === "@executor-js/plugin-mcp")).toHaveLength(1);
          expect(packageNames.some((name) => String(name).includes("onepassword"))).toBe(false);
        }),
      ),
    ),
  );

  it.effect("creates Node SQLite storage and executes code", () =>
    withFixture((fixture) =>
      silenceExpectedDuplicateWarning(
        Effect.acquireUseRelease(
          Effect.gen(function* () {
            writeProjectConfig(fixture);
            return yield* createExecutorHost({ cwd: fixture.projectDir });
          }),
          (host) =>
            Effect.gen(function* () {
              const scope = resolveExecutorScope(fixture.projectDir);

              expect(host.scopeDir).toBe(scope.scopeDir);
              expect(host.scopeId).toBe(scope.scopeId);
              expect(host.dataDir).toBe(fixture.dataDir);
              expect(host.sqlitePath).toBe(join(fixture.dataDir, "data.db"));
              expect(host.configPath).toBe(join(fixture.projectDir, "executor.jsonc"));
              expect(existsSync(host.sqlitePath)).toBe(true);

              const execution = yield* host.engine.execute("return { value: 1 + 2 };", {
                onElicitation: () => Effect.succeed({ action: "cancel" as const }),
              });

              expect(execution.result).toEqual({ value: 3 });
            }),
          (host) => host.close(),
        ),
      ),
    ),
  );

  it.effect("caches, reloads, and closes hosts through ExecutorHostService", () =>
    withFixture((fixture) =>
      silenceExpectedDuplicateWarning(
        Effect.gen(function* () {
          writeProjectConfig(fixture);

          const service = yield* ExecutorHostService;
          const first = yield* service.get(fixture.projectDir);
          const cached = yield* service.get(fixture.projectDir);
          const reloaded = yield* service.reload(fixture.projectDir);
          yield* service.closeAll;

          expect(cached).toBe(first);
          expect(reloaded).not.toBe(first);
        }).pipe(Effect.provide(ExecutorHostService.Default)),
      ),
    ),
  );
});
