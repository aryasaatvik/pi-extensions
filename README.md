# pi-extensions

Monorepo for [Pi coding agent](https://github.com/badlogic/pi-mono) extensions.

This repository currently contains local extensions for web research and
Executor integration. Packages share one Bun workspace, one lockfile, and
root-level TypeScript, lint, and format tooling.

## Packages

| Package                                                   | Description                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`@pi-ext/web`](./packages/web)                           | `web_search` and `web_fetch` tools with a pluggable provider layer. Supports Exa and Parallel.                       |
| [`@pi-ext/executor`](./packages/executor)                 | `executor_search` and `executor_execute`: a typed client and Pi tools for a hosted Executor server.                  |
| [`@pi-ext/kit`](./packages/kit)                           | Preset that installs the `ask` tool and permission modes together in one package.                                    |
| [`@pi-ext/ask`](./packages/ask)                           | An `ask` tool letting the model pose multiple-choice questions to the user (mirrors Claude Code's AskUserQuestion).  |
| [`@pi-ext/permission-modes`](./packages/permission-modes) | Claude-Code-style permission modes (Shift+Tab) with a merged allow/deny/ask rule engine and an approval overlay.     |
| [`@pi-ext/ui`](./packages/ui)                             | Shared terminal UI primitives: a reusable choice overlay (options, multi-select, notes, preview) + a question shell. |

## Install In Pi

Install one package:

```bash
pi install /path/to/pi-extensions/packages/web
pi install /path/to/pi-extensions/packages/executor
```

Or add packages to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["/path/to/pi-extensions/packages/web", "/path/to/pi-extensions/packages/executor"]
}
```

## Configuration

### `@pi-ext/web`

Credentials are read from `~/.pi/agent/auth.json` under provider ids `exa` and/or
`parallel`.

```json
{
  "exa": {
    "type": "api_key",
    "key": "..."
  },
  "parallel": {
    "type": "api_key",
    "key": "..."
  }
}
```

Use `/web config` in Pi for provider/default settings.

### `@pi-ext/executor`

Set `EXECUTOR_BASE_URL`, plus the Cloudflare Access token
(`EXECUTOR_CLIENT_ID[_FILE]`, `EXECUTOR_CLIENT_SECRET[_FILE]`) when the server
sits behind Access. See [the package README](./packages/executor/README.md).
Use `/executor` in Pi to check the connection.

## Development

Install dependencies from the workspace root:

```bash
bun install
```

Run all package typechecks and tests plus root lint/format checks:

```bash
bun run check
```

Run package-specific checks:

```bash
bun run --filter @pi-ext/web check
bun run --filter @pi-ext/executor check
```

Root-owned tooling:

```bash
bun run typecheck
bun run test
bun run lint
bun run format:check
bun run format
```

Package-level `oxlint` and `oxfmt` configs are intentionally not duplicated.
Root [`oxlint.config.ts`](./oxlint.config.ts) and
[`oxfmt.config.ts`](./oxfmt.config.ts) apply to all packages.

## Releasing

Only `@pi-ext/executor` publishes to npm. Run `bun run tegami` (no subcommand)
to add an interactive release note under `.tegami/`, then commit it with the change.
Merging to `main` runs checks and opens the `tegami/version-packages` version PR.
Merging that PR publishes with npm provenance, creates the per-package tag
(e.g. `@pi-ext/executor@1.0.1`), and creates its GitHub release.
GitHub Actions must be allowed to create pull requests in the repository settings.

`bun run version:packages` versions locally; `bun run release` checks and publishes
an existing publish lock. Preview it with `bun run tegami publish --dry-run` or
by dispatching the Publish workflow with `dry_run` enabled. Tegami uses Bun to pack
and resolve `catalog:` versions, then npm to publish the tarball using trusted publishing.
The initial publish lock selects the current executor `1.0.0` without bumping it;
Tegami requires that lock even when the package has never been published.

### One-time bootstrap

[npm requires the package to exist before configuring a trusted publisher](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites).
Before enabling the first publish run, a logged-in maintainer must run `bun publish`
from `packages/executor` once to publish `@pi-ext/executor@1.0.0` (and must own or have
publish access to the `@pi-ext` scope). Then, in that package's npmjs.com settings,
add a GitHub trusted publisher: owner `aryasaatvik`, repository `pi-extensions`,
workflow `publish.yml`, no environment, with permission to publish. After this setup,
CI owns subsequent releases with provenance; the manual bootstrap publish has no
CI provenance. CI skips the already-published npm version and completes its tag and
GitHub release. No npm token is needed in GitHub Actions.

## Workspace Notes

- Root `bun.lock` is authoritative.
- `packages/executor` vendors `fumadb` under `packages/executor/vendor/`.
  The workspace root owns the dependency and override so Executor SDK resolves
  the patched package.
