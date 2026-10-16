import { execFileSync } from "node:child_process";
import type { TegamiPlugin } from "tegami";

export const releaseChecks = (): TegamiPlugin => ({
  name: "pi-extensions-release-checks",
  enforce: "pre",
  afterPreflight({ plan }) {
    if (plan.packages.get("npm:@pi-ext/executor")?.preflight?.shouldPublish !== true) return;

    execFileSync("bun", ["run", "release:check"], {
      cwd: this.cwd,
      stdio: "inherit",
    });
  },
});
