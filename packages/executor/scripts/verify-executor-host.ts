#!/usr/bin/env node
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

import { createExecutorHost } from "../src/executor/index.ts";

interface Dependencies {
  readonly fumadb?: string;
  readonly [name: string]: string;
}

interface Overrides {
  readonly fumadb: string;
  readonly [name: string]: string;
}

interface PackageJson {
  readonly dependencies: Dependencies;
  readonly workspaces?: readonly string[];
  readonly peerDependencies?: Dependencies;
  readonly overrides?: Overrides;
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

  const host = await Effect.runPromise(createExecutorHost({ cwd: projectDir }));

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
  const fumadbDependency = repoPackage.dependencies.fumadb;
  const rootFumadbDependency = rootPackage.dependencies.fumadb;
  const rootFumadbOverride = rootPackage.overrides?.fumadb;

  assert(fumadbDependency === undefined, "executor package must not install a second fumadb copy");
  assert(
    rootFumadbDependency === "file:packages/executor/vendor/fumadb",
    "root fumadb dependency must point at the vendored package",
  );
  assert(
    rootFumadbOverride === "file:packages/executor/vendor/fumadb",
    "root fumadb override must point at the vendored package",
  );
  assert(
    existsSync(join(rootDir, "packages/executor/vendor/fumadb/package.json")),
    "vendored fumadb package must exist",
  );

  console.log("Executor host runtime verification passed.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
