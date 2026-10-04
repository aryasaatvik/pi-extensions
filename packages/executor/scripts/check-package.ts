import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const Versions = Schema.Record(Schema.String, Schema.String);
const PackedManifest = Schema.Struct({
  name: Schema.String,
  dependencies: Versions,
  devDependencies: Versions,
  peerDependencies: Versions,
  exports: Schema.Record(
    Schema.String,
    Schema.Struct({ types: Schema.String, import: Schema.String }),
  ),
});
const RootManifest = Schema.Struct({ devDependencies: Versions });

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status})`);
  }
  return result.stdout;
}

const tempDir = await mkdtemp(join(tmpdir(), "pi-executor-package-"));
try {
  const tarball = join(tempDir, "executor.tgz");
  run("bun", ["pm", "pack", "--filename", tarball], packageDir);
  const entries = run("tar", ["-tzf", tarball], tempDir).trim().split("\n");
  assert(
    entries.every((entry) => !entry.split("/").includes("src")),
    "Tarball contains src/",
  );
  run("tar", ["-xzf", tarball, "-C", tempDir], tempDir);
  const manifestText = await readFile(join(tempDir, "package/package.json"), "utf8");
  assert(
    !manifestText.includes("catalog:"),
    "Packed manifest contains unresolved catalog: versions",
  );
  const packed = Schema.decodeUnknownSync(Schema.fromJsonString(PackedManifest))(manifestText);
  for (const [entry, conditions] of Object.entries(packed.exports)) {
    for (const [condition, target] of Object.entries(conditions)) {
      assert(
        target.startsWith("./") && entries.includes(`package/${target.slice(2)}`),
        `Missing packed export ${entry} ${condition}: ${target}`,
      );
    }
  }
  const root = Schema.decodeUnknownSync(Schema.fromJsonString(RootManifest))(
    await readFile(resolve(packageDir, "../../package.json"), "utf8"),
  );
  const dependencies: Record<string, string> = {
    ...packed.dependencies,
    [packed.name]: `file:${tarball}`,
  };
  for (const peer of Object.keys(packed.peerDependencies)) {
    const version = packed.devDependencies[peer];
    assert(
      version && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version),
      `Peer ${peer} needs an exact catalog version`,
    );
    dependencies[peer] = version;
  }
  assert(root.devDependencies.typescript, "Root manifest must declare TypeScript");
  dependencies.typescript = root.devDependencies.typescript;
  // Pi's declarations reference path.PlatformPath, which was removed from Node 25 types.
  dependencies["@types/node"] = "^22.0.0";
  // Google GenAI's declarations reference its optional MCP peer even without MCP usage.
  dependencies["@modelcontextprotocol/sdk"] = "^1.0.0";

  const consumerDir = join(tempDir, "consumer");
  await mkdir(consumerDir);
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }),
  );
  await writeFile(
    join(consumerDir, "bunfig.toml"),
    '[install]\nlinker = "hoisted"\nglobalStore = false\n',
  );
  run("bun", ["install"], consumerDir);
  console.log(`Package contents and consumer install passed (${entries.length} files)`);

  await writeFile(
    join(consumerDir, "consumer.ts"),
    `import { executorTools, ExecutorClient, type ExecutorTraceRecord } from "@pi-ext/executor";
import ext from "@pi-ext/executor/extension";

export function toolPath(record: ExecutorTraceRecord): string | undefined {
  if (record.kind === "execute" && record.toolCalls?.length) {
    const path: string = record.toolCalls[0].path;
    return path;
  }
  return undefined;
}

void [executorTools, ExecutorClient.create, ext];
`,
  );
  const compilerOptions = { strict: true, target: "ESNext", noEmit: true, skipLibCheck: false };
  await writeFile(
    join(consumerDir, "tsconfig.bundler.json"),
    JSON.stringify({
      compilerOptions: { ...compilerOptions, module: "ESNext", moduleResolution: "Bundler" },
      files: ["consumer.ts"],
    }),
  );
  // NodeNext skips library checking because upstream pi-ai JSON declarations fail with TS1543.
  await writeFile(
    join(consumerDir, "tsconfig.nodenext.json"),
    JSON.stringify({
      compilerOptions: {
        ...compilerOptions,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        skipLibCheck: true,
      },
      files: ["consumer.ts"],
    }),
  );
  for (const mode of ["bundler", "nodenext"]) {
    run("bun", ["run", "tsc", "--noEmit", "-p", `tsconfig.${mode}.json`], consumerDir);
    console.log(`Consumer ${mode} typecheck passed`);
  }
  run(
    "node",
    [
      "--input-type=module",
      "-e",
      `import { executorTools, ExecutorClient } from "@pi-ext/executor";
import ext from "@pi-ext/executor/extension";
import assert from "node:assert/strict";
assert.equal(typeof executorTools, "function");
assert.equal(typeof ExecutorClient.create, "function");
assert.equal(typeof ext, "function");`,
    ],
    consumerDir,
  );
  console.log("Consumer Node imports passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
