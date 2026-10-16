import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PackagePublishTask, WorkspacePackage, tegami } from "tegami";
import type { TegamiPlugin } from "tegami";
import { releaseChecks } from "./release-checks.mts";

// A non-registry package keeps Tegami's real pipeline without npm or GitHub operations.
class FixturePackage extends WorkspacePackage {
  readonly name = "@pi-ext/executor";
  readonly manager = "npm";
  readonly version = "1.0.0";
  constructor(readonly path: string) {
    super();
  }
}

class FixturePublish extends PackagePublishTask {
  status() {
    return "pending" as const;
  }
  async publish() {
    assert.equal(await readFile(join(this.pkg.path, "checked"), "utf8"), "passed");
    await writeFile(join(this.pkg.path, "published"), "yes");
    return { type: "published" as const };
  }
}

for (const scenario of ["failed", "passed", "not-selected"]) {
  test(`release gate: ${scenario}`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-release-gate-"));
    try {
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({
          private: true,
          scripts: {
            "release:check":
              scenario === "failed"
                ? 'bun -e "process.exit(17)"'
                : 'bun -e \'require("node:fs").writeFileSync("checked", "passed")\'',
          },
        }),
      );
      await writeFile(
        join(cwd, "publish-lock.yaml"),
        "core:packages:\n  - id: npm:@pi-ext/executor\n    updated: true\n",
      );
      const pkg = new FixturePackage(cwd);
      const provider: TegamiPlugin = {
        name: "local-fixture",
        enforce: "post",
        resolve() {
          this.graph.add(pkg);
        },
        publishPreflight() {
          return { shouldPublish: scenario !== "not-selected" };
        },
        publishTasks({ plan }) {
          return plan.getPackagesToPublish().map((entry) => new FixturePublish(entry));
        },
      };
      const paper = tegami({
        cwd,
        lockPath: "publish-lock.yaml",
        npm: { client: "bun" },
        plugins: [releaseChecks(), provider],
      });
      if (scenario === "failed") {
        await assert.rejects(paper.publish(), /release:check/);
      } else {
        await paper.publish();
      }
      assert.equal(existsSync(join(cwd, "published")), scenario === "passed");
      assert.equal(existsSync(join(cwd, "checked")), scenario === "passed");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
