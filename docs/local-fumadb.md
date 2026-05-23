# Local FumaDB Package

`pi-executor` uses a local `fumadb` tarball generated from
`~/Developer/executor/packages/core/fumadb`.

This is a package/export workaround, not a host ownership workaround. The Pi
host remains owned under `src/executor`.

## Why It Exists

The published package shape used by the Executor SDK does not currently expose
all imports needed by this package, specifically the memory adapter export used
by SDK internals. Executor carries the customized package in its repo.

## Regeneration

Run:

```bash
bun run deps:pack-fumadb
```

The script:

- runs `bun pm pack` in Executor's `packages/core/fumadb`
- promotes `publishConfig.exports` into package `exports`
- removes package scripts and dev dependencies from the packed copy
- verifies `dist/adapters/memory/index.js` is present and exported
- writes `.local-packages/fumadb-<version>-<executor-short-sha>.tgz`
- updates both `dependencies.fumadb` and `overrides.fumadb`

`.local-packages/` is ignored because the tarball is generated local state.

## Validation

Run:

```bash
bun run verify:host
```

The verifier checks that `package.json` points at a short-SHA `fumadb` tarball
and that the override matches the dependency.
