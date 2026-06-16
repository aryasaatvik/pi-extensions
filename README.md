# pi-extensions

Monorepo for [Pi coding agent](https://github.com/badlogic/pi-mono) extensions.

This repository currently contains local extensions for web research and
Executor integration. Packages share one Bun workspace, one lockfile, and
root-level TypeScript, lint, and format tooling.

## Packages

| Package                                   | Description                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`@pi-ext/web`](./packages/web)           | `web_search` and `web_fetch` tools with a pluggable provider layer. Supports Exa and Parallel.                        |
| [`@pi-ext/executor`](./packages/executor) | Native Pi extension for Executor search, execution, elicitation, rendering, and project-aware Executor configuration. |
| [`@pi-ext/kit`](./packages/kit)           | Preset that installs the `ask` tool and permission modes together in one package.                                    |
| [`@pi-ext/ask`](./packages/ask)           | An `ask` tool letting the model pose multiple-choice questions to the user (mirrors Claude Code's AskUserQuestion).   |
| [`@pi-ext/permission-modes`](./packages/permission-modes) | Claude-Code-style permission modes (Shift+Tab) with a merged allow/deny/ask rule engine and an approval overlay.      |
| [`@pi-ext/ui`](./packages/ui)             | Shared terminal UI primitives: a reusable choice overlay (options, multi-select, notes, preview) + a question shell.  |

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

Executor project behavior comes from `executor.jsonc` in the active project.
Pi-specific display and render settings live in:

- Global: `~/.pi/agent/executor-pi.json`
- Project override: `.pi/executor-pi.json`

Use `/executor config` in Pi to edit display density, search defaults, and render
limits.

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

## Workspace Notes

- Root `bun.lock` is authoritative.
- `packages/executor` vendors `fumadb` under `packages/executor/vendor/`.
  The workspace root owns the dependency and override so Executor SDK resolves
  the patched package.
