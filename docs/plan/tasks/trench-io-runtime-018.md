---
id: trench-io-runtime-018
scope: main/renderer/shared/trench
status: done
depends-on: [trench-index-analysis-017]
---

# Trench IO Hidden Runtime

## Objective

Rename and relocate the dedicated hidden Trench SQLCipher renderer runtime to the exact process
identity `trench-io`. Its complete runtime source must live under `src/renderer/trench-io/`, where a
CSP-locked blank HTML page is paired with the preload-owned SQLite implementation. Preserve the
existing encrypted database, schema, INDEX behavior, and public APIs.

## Context

- [`../../features/trench-index.md`](../../features/trench-index.md)
- [`../analysis/trench-index-analysis.md`](../analysis/trench-index-analysis.md)
- [`trench-index-analysis-017.md`](trench-index-analysis-017.md)

The current branch is `dev/current`; do not switch or create a branch. Preserve unrelated
OnlyPreview and other dirty-worktree changes. Keep the running DEBUG_PROD application/profile and
database untouched.

## Path

- `docs/features/trench-index.md`
- `docs/plan/analysis/trench-index-analysis.md`
- `docs/plan/tasks/trench-io-runtime-018.md`
- `docs/plan/results/trench-io-runtime-018.md`
- `docs/plan/README.md`
- `src/renderer/trench-io/**`
- obsolete `src/renderer/trenchStorage/**` and `src/preload/trenchStorage/**`
- `src/main/trench/trenchIo*.ts`
- obsolete `src/main/trench/trenchStorage*.ts`
- `src/main/xpc/trenchIoSystem.handler.ts`
- obsolete `src/main/xpc/trenchStorageSystem.handler.ts`
- `src/main/app.main.ts`
- `src/main/coin/index/trenchIndex.runtime.ts`
- `src/main/xpc/xpc.helper.ts`
- `src/shared/trench/trenchIndex.type.ts`
- `electron.vite.config.ts`
- `scripts/coin/trench-index-layout.test.mjs`
- `scripts/sqlite-migrations/auditRunner.ts`
- `tests/coin/**` only where runtime paths/names are asserted

## Contract

1. The hidden BrowserWindow/document/build target/runtime/XPC identity is exactly `trench-io` or
   `TrenchIo` according to filename/identifier conventions; stale process-specific
   `trenchStorage` names are removed.
2. All runtime implementation files move under `src/renderer/trench-io/`. The preload build entry
   points there and produces `out/preload/trench-io.js`; the renderer entry produces
   `out/renderer/trench-io/index.html`.
3. `src/renderer/trench-io/index.html` has a restrictive CSP and an empty body. It imports no
   script, stylesheet, remote resource, or renderer bridge.
4. Native SQLCipher continues to execute only in that hidden renderer's preload with
   `sandbox:false`, `contextIsolation:true`, `nodeIntegration:false`, and `webSecurity:true`.
   Main and the blank page must not import SQLite or execute SQL.
5. Runtime arguments, private handler names, capability registry, lifecycle service, startup
   diagnostic stage, and error prefixes use `trench-io`; capability/instance fencing, navigation
   denial, bounded restart, and unavailable broadcasts are preserved.
6. Preserve `userData/trench/trench.db`, `trench.key.bin`, all table/index/migration names and
   version codes, current records, INDEX commands/results, and the exact 12 public `trench.*` MCP
   tools. This task is a runtime identity/source-location migration, not a data migration.

## Verification

- Focused static contract proves the exact `trench-io` source/build/runtime identity, blank page,
  preload-only native module, removed old source/output paths, and Main SQL exclusion.
- Existing Coin/INDEX unit tests and native repository tests pass after import relocation.
- Narrow node/preload/Trench renderer typechecks and SQLite migration audit pass.
- Fresh isolated DEBUG_DEV build contains `out/preload/trench-io.js` and
  `out/renderer/trench-io/index.html`, with no obsolete `trenchStorage` output.
- Focused isolated Electron INDEX E2E proves startup, Add/reanalysis/read paths, and hidden-runtime
  recovery continue to work. DEBUG_PROD remains running and untouched.
- `git diff --check`; independent Verify review under `docs/plan/reviews/`.
