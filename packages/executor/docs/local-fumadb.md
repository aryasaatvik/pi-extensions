# Local FumaDB Package

`@pi-ext/executor` uses a vendored `fumadb` package generated from
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
- writes `vendor/fumadb-<version>-<executor-short-sha>.tgz`
- extracts that tarball into `vendor/fumadb`
- keeps root `dependencies.fumadb` and `overrides.fumadb` pointed at
  `file:packages/executor/vendor/fumadb`

`@pi-ext/executor` does not declare `fumadb` directly. The root dependency and
override make Bun resolve Executor SDK and local source to one vendored
`fumadb` instance.

## Validation

Run:

```bash
bun run verify:host
```

The verifier checks that `fumadb` is wired through the root vendored package and
that the host can create local SQLite storage under Node/jiti.
