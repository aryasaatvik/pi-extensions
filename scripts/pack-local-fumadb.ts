#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue | undefined };

interface Dependencies {
  fumadb: string;
  [name: string]: string;
}

interface Overrides {
  fumadb: string;
  [name: string]: string;
}

interface PiPackage {
  dependencies: Dependencies;
  overrides: Overrides;
  [field: string]: JsonValue | Dependencies | Overrides;
}

interface FumadbPackage extends JsonObject {
  name: string;
  version: string;
  exports?: JsonValue;
  publishConfig?: {
    exports?: JsonValue;
  };
  scripts?: JsonObject;
  devDependencies?: JsonObject;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "..");
const executorFumadbDir =
  process.env.EXECUTOR_FUMADB_DIR ?? resolve(repoDir, "../executor/packages/core/fumadb");
const localPackagesDir = join(repoDir, ".local-packages");
const repoPackagePath = join(repoDir, "package.json");

const run = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly capture?: boolean },
): string => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    throw new Error(`${command} ${args.join(" ")} failed in ${options.cwd}\n${stderr}`.trim());
  }

  return typeof result.stdout === "string" ? result.stdout : "";
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const writeJson = <T>(path: string, value: T): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const sourcePackagePath = join(executorFumadbDir, "package.json");
if (!existsSync(sourcePackagePath)) {
  throw new Error(`Expected fumadb package at ${sourcePackagePath}`);
}

const sourcePackage = readJson<FumadbPackage>(sourcePackagePath);
if (sourcePackage.name !== "fumadb") {
  throw new Error(`Expected package name fumadb, found ${sourcePackage.name}`);
}

const distMemoryAdapter = join(executorFumadbDir, "dist/adapters/memory/index.js");
if (!existsSync(distMemoryAdapter)) {
  throw new Error(
    `Missing ${distMemoryAdapter}. Build fumadb in ~/Developer/executor before packing it.`,
  );
}

const executorCommit = run("git", ["rev-parse", "--short", "HEAD"], {
  cwd: executorFumadbDir,
  capture: true,
}).trim();
const bunPackedFileName = `fumadb-${sourcePackage.version}.tgz`;
const outputFileName = `fumadb-${sourcePackage.version}-${executorCommit}.tgz`;
const sourceTarballPath = join(executorFumadbDir, bunPackedFileName);
rmSync(sourceTarballPath, { force: true });

run("bun", ["pm", "pack"], { cwd: executorFumadbDir });

if (!existsSync(sourceTarballPath)) {
  throw new Error(`Expected bun pack to create ${sourceTarballPath}`);
}

const tempDir = mkdtempSync(join(tmpdir(), "pi-executor-fumadb-"));
try {
  run("tar", ["-xzf", sourceTarballPath, "-C", tempDir], { cwd: repoDir });

  const packedPackagePath = join(tempDir, "package/package.json");
  const packedPackage = readJson<FumadbPackage>(packedPackagePath);
  const distExports = sourcePackage.publishConfig?.exports;
  if (distExports === undefined) {
    throw new Error("fumadb package.json does not define publishConfig.exports");
  }

  const sanitizedPackage = {
    ...packedPackage,
    exports: distExports,
  };
  delete sanitizedPackage.publishConfig;
  delete sanitizedPackage.scripts;
  delete sanitizedPackage.devDependencies;

  writeJson(packedPackagePath, sanitizedPackage);

  mkdirSync(localPackagesDir, { recursive: true });
  for (const entry of readdirSync(localPackagesDir)) {
    const isPackedFumadb =
      entry === bunPackedFileName ||
      (entry.startsWith(`fumadb-${sourcePackage.version}-`) && entry.endsWith(".tgz"));
    if (isPackedFumadb) {
      rmSync(join(localPackagesDir, entry), { force: true });
    }
  }

  const outputTarballPath = join(localPackagesDir, outputFileName);
  rmSync(outputTarballPath, { force: true });
  run("tar", ["-czf", outputTarballPath, "-C", tempDir, "package"], { cwd: repoDir });

  const contents = run("tar", ["-tf", outputTarballPath], { cwd: repoDir, capture: true });
  if (!contents.includes("package/dist/adapters/memory/index.js")) {
    throw new Error("Packed fumadb tarball is missing dist/adapters/memory/index.js");
  }

  const verifiedPackage = JSON.parse(
    run("tar", ["-xOf", outputTarballPath, "package/package.json"], {
      cwd: repoDir,
      capture: true,
    }),
  ) as FumadbPackage;
  if (!JSON.stringify(verifiedPackage.exports).includes("dist/adapters/memory")) {
    throw new Error("Packed fumadb tarball does not export dist/adapters/memory");
  }

  const repoPackage = readJson<PiPackage>(repoPackagePath);
  const tarballDependency = `file:.local-packages/${outputFileName}`;
  repoPackage.dependencies.fumadb = tarballDependency;
  repoPackage.overrides.fumadb = tarballDependency;
  writeJson(repoPackagePath, repoPackage);

  console.log(`Packed local fumadb: ${outputTarballPath}`);
} finally {
  rmSync(tempDir, { force: true, recursive: true });
  rmSync(sourceTarballPath, { force: true });
}
