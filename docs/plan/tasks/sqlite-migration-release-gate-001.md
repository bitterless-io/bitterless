---
id: sqlite-migration-release-gate-001
scope: strict Core and Maestro SQLite upgrade audit before all production packages
status: in-progress
depends-on: []
---

# SQLite Migration Release Gate

## Objective

Implement and verify the contract in `docs/features/sqlite-migration-release-gate.md`, then release
one production version to macOS ARM64, macOS x64, and Windows x64 only if every gate passes.

## Context

- `docs/features/sqlite-migration-release-gate.md`
- `docs/plan/analysis/sqlite-migration-release-gate.md`
- `src/preload/sqlite/dao/dao.spec.md`
- `scripts/publish.js`

## Path

- `src/preload/common/`
- `src/preload/sqlite/`
- `src/preload/maestro/sqlite/`
- `src/preload/maestro/sqlite.preload.ts`
- `src/shared/**/packageHelper/`
- `src/main/updateHelper/`
- `src/main/maestro/windows/maestroWindow.helper.ts`
- `scripts/sqlite-migrations/`
- `scripts/before.js`
- `scripts/patch.js`
- `scripts/publish.js`
- `package.json`
- `yarn.lock`
- `build/release_note.md`
- the referenced docs and review artifact

## Verification

- `yarn audit:sqlite-migrations`
- focused test proves invalid ordering, duplicate IDs, build-version mismatch, rollback, and no
  failed ledger insert;
- focused test proves historical-width and current `YYMMDDHHmmss` strings are ordered through
  `compare-versions`, with no raw numeric version comparison in release paths;
- Core matrix covers no ledger, historical 10-digit ledger, later 8-digit ledgers, and each
  EyesOnAgents shape;
- Maestro matrix covers every registered checkpoint and multi-version jumps;
- `yarn typecheck:node`
- `yarn test:eyes-on-agents:repository`
- production build hook source test proves audit runs before any build/sign/publish step;
- `git diff --check`;
- process audit proves no audit/test/Electron helper remains;
- after code sync, production release and public manifest/artifact verification pass for
  `mac_arm`, `mac_intel`, and `win64`.
