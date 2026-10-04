import { tegami } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const paper = tegami({
  // Add a package by adding its publish metadata and removing it from ignore.
  ignore: [
    "@pi-ext/ask",
    "@pi-ext/kit",
    "@pi-ext/permission-modes",
    "@pi-ext/subagents",
    "@pi-ext/ui",
    "@pi-ext/web",
  ],
  npm: {
    client: "bun",
    updateLockFile: true,
    trustedPublish: { provider: "github", workflow: "publish.yml" },
  },
  packages: {
    "@pi-ext/executor": {},
  },
  plugins: [
    github({
      repo: "aryasaatvik/pi-extensions",
      pushTags: true,
      versionPr: {
        branch: "tegami/version-packages",
        base: "main",
        forceCreate: false,
        create() {
          return { title: "chore(release): prepare packages" };
        },
      },
      release: {
        create({ tag }) {
          return { title: tag };
        },
      },
    }),
  ],
});

await runCli(paper);
