#!/usr/bin/env node
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

import { createExecutorHost } from "../src/executor/index.ts";
import { makeTestSearchEmbeddingProvider } from "../src/search/test-embeddings.ts";

interface Dependencies {
  readonly [name: string]: string;
}

interface PackageJson {
  readonly dependencies?: Dependencies;
  readonly overrides?: Dependencies;
}

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const workspace = mkdtempSync(join(tmpdir(), "executor-pi-host-runtime-"));
const projectDir = join(workspace, "project");
const dataDir = join(workspace, "data");

try {
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  process.env.EXECUTOR_DATA_DIR = dataDir;

  // Exercise the full hybrid (FTS + vector) index build with a deterministic,
  // offline embedder so the smoke needs no external embedding server.
  const host = await Effect.runPromise(
    createExecutorHost({
      cwd: projectDir,
      searchModeOverride: "hybrid",
      searchEmbedderOverride: makeTestSearchEmbeddingProvider(),
    }),
  );

  try {
    assert(existsSync(host.sqlitePath), "host must create SQLite storage under Node/jiti");

    const execution = await Effect.runPromise(
      host.engine.execute("return 1 + 2;", {
        onElicitation: () => Effect.succeed({ action: "cancel" as const }),
      }),
    );
    assert(execution.result === 3, "host engine must execute code under Node/jiti");
  } finally {
    await Effect.runPromise(host.close());
  }

  const packageDir = process.cwd();
  const rootDir = join(packageDir, "../..");
  const repoPackage = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as PackageJson;
  const rootPackage = JSON.parse(
    readFileSync(join(rootDir, "package.json"), "utf8"),
  ) as PackageJson;
  assert(
    repoPackage.dependencies?.["@executor-js/fumadb"] !== undefined,
    "executor package must depend on @executor-js/fumadb (linked from the selfhost worktree)",
  );
  assert(
    rootPackage.dependencies?.fumadb === undefined && rootPackage.overrides?.fumadb === undefined,
    "the vendored 'fumadb' dependency/override must be removed (executor uses @executor-js/fumadb)",
  );
  assert(
    !existsSync(join(rootDir, "packages/executor/vendor")),
    "the vendored fumadb directory must be removed",
  );

  console.log("Executor host runtime verification passed.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
