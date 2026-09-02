---
id: maestro-sqlite-build-version-093
scope: restore Maestro startup by ordering the canonical app build after its current SQLite manifest
status: implemented; owner verification pending
depends-on: [maestro-cowork-chat-core-089]
verify: SQLite migration audit, diff check, independent source review; no Electron/E2E
---

# Restore Maestro SQLite build/migration ordering

## Objective

Repair the startup failure caused by `package.json.version_code` being older than Maestro migration
`260831200000`, while preserving the migration history and the shared fail-closed release contract.

## Context

- `docs/issues/maestro-sqlite-build-version-behind-migration.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/plan/analysis/sqlite-migration-release-gate.md`
- `src/preload/sqlite/dao/dao.spec.md`
- `src/preload/common/sqliteMigration.service.ts`

## Path

- `package.json` (`version_code` only)
- `scripts/sqlite-migrations/auditRunner.ts`
- this task, its issue, indexes, and review artifact

## Contract

- Set the canonical app `version_code` to one valid current `YYMMDDHHmmss` value strictly newer
  than every registered Core and Maestro migration.
- Do not change `version`, `_version`, release channel, migration IDs, migration runners, database
  paths, or the shared version-order validation.
- Add the two columns introduced by Maestro migration `260831200000` to the production-manifest
  schema assertions: `tasks_json` and `confirm_json`.
- Preserve fresh-database stamping, historical multi-version upgrade, transactional ledger, and
  retry-safe behavior. Do not add cleanup or compensating SQL.
- Preserve unrelated worktree changes.

## Verification

- `yarn audit:sqlite-migrations`
- inspect the task-scoped diff and migration call chain;
- `git diff --check`;
- independent review for P0-P2 migration/history defects;
- do not launch Electron or run Playwright/E2E; Ral owns runtime acceptance.

## Delivery

- Advanced only `package.json.version_code` from `260831132610` to `260901095140`, preserving the
  semantic version and release configuration.
- Preserved every Core/Maestro migration identifier, runner, database path, ledger rule, and shared
  fail-closed validation.
- Added `tasks_json` and `confirm_json` to the production-manifest Maestro schema assertions.
- `yarn audit:sqlite-migrations` passed all 14 Core, 7 Maestro, 10 Todoist sync, and 8 Trench
  baselines; `git diff --check` passed.
- [Independent review 1](../reviews/maestro-sqlite-build-version-093-1.md) approved the repair with
  no P0-P2 findings. Electron/E2E and application launch were not run; Ral owns runtime acceptance.
