# Executor Host Contract

`src/executor` owns the local Executor runtime embedded in the Pi extension. It
assembles Executor plugins, project configuration, storage, SDK state, and the
execution engine for the active Pi cwd.

## Runtime

- Pi loads extensions through Node/jiti.
- SQLite access is Node-native and backed by `better-sqlite3`.

## Boundary

Higher-level Pi code depends on `ExecutorHostService`, not individual host
modules. The service exposes:

- `get(cwd)`: create or reuse a host for the cwd.
- `reload(cwd)`: close the cached host and replace it.
- `closeAll`: close all cached hosts at session shutdown.

The host exposes only the fields Pi needs for execution, diagnostics, and
lifecycle:

- `executor`
- `engine`
- `plugins`
- `scopeDir`
- `scopeId`
- `dataDir`
- `sqlitePath`
- `configPath`
- `close`
- `reload`

## Compatibility Points

The host preserves these Executor local semantics:

- scope id is `<project-basename>-<sha256(cwd).slice(0, 8)>`
- project config is `executor.jsonc` in the active cwd
- static plugins load first
- dynamic `executor.jsonc#plugins` append after static plugins
- static plugin package names win when dynamic config duplicates them
- local data lives under `EXECUTOR_DATA_DIR` or `~/.executor`
- SQLite file is `data.db`

The host boundary excludes app and server concerns:

- Executor Bun server
- Executor web UI
- Executor HTTP API
- Executor MCP server
- browser resume routes
- OnePassword static plugin policy

## Verification

Run:

```bash
bun run test
bun run verify:host
```

The Effect/Vitest suite verifies scope identity, static/dynamic plugin
precedence, Node SQLite storage, execution through the engine, and host service
cache/reload behavior.

The `verify:host` script is a Node/jiti runtime smoke. It verifies the TypeScript
host loads through Pi's extension runtime path, native SQLite initializes there,
execution works there, and the hybrid search index builds end-to-end with an
offline embedder (no external embedding server) using `@executor-js/fumadb`.
