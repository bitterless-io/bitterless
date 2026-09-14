# Maestro startup is blocked by a migration newer than the app build

Status: implemented 2026-09-12; Agent Build restart verification pending

## 2026-09-12 recurrence

Ral reports Agent Build failing to open Maestro with
`Current version_code 260910164530 is older than migration 260911140000` and the obsolete
`[coach sqlite]` diagnostic prefix. At investigation time the checked-out package and production
Maestro manifest contained those exact values. Migration `260911140000` adds `tabs.kind` and
`tabs.instance_id`.

The previous one-time metadata bump did not repair the build entry: `scripts/before.js` validates
the timestamp format but preserves an old value, whereas `scripts/patch.js` refreshes it only when
cutting a release. Both DEBUG build/dev commands use `before.js`. Maestro also reads metadata
files at runtime, while Core SQLite uses the version embedded by the Vite build.

Required repair: stamp DEBUG build/dev preparation with the current local timestamp, keep release
identity stable, use the same embedded build version for both SQLite preloads, and rename the
SQLite startup/key diagnostics to `[maestro sqlite]`. Keep the existing database paths, keys,
migration identifiers and fail-closed version guard. Verify fresh and historical upgrades through
the real manifest, including the new tab columns. Do not launch Electron or touch Ral's databases.

Follow-up task: [maestro-sqlite-agent-build-173](../plan/tasks/maestro-sqlite-agent-build-173.md).

## Current resolution

- DEBUG build/dev preparation now refreshes the local timestamp and refuses backwards clocks;
  release preparation preserves the already-cut identity.
- Maestro and Core SQLite both use the version embedded by the build. SQLite startup/key
  diagnostics now use `[maestro sqlite]`.
- Final DEBUG_PROD artifacts embed `260912203727`, later than migration `260911140000`;
  semantic version `0.0.100` and the original runtime configuration are preserved.
- The real migration audit passes 14 Core, 9 Maestro, 10 Todoist sync and 8 Trench cases,
  including the latest tab columns, retained tab data and repeated migrations.
- Build/profile tests pass 18/18; release-hook tests pass 37/37. Migration typecheck and both
  DEBUG_DEV/DEBUG_PROD builds pass. Independent review found no blocking issues; the task records
  the unrelated existing type/lint failures and the unrun Electron/E2E acceptance.
- Restart instructions were sent to Ral in BotAndI. The Production Bitterless MCP bridge is
  unavailable, so the acceptance Todo and OnlyPreview handoff could not be completed.

## Earlier occurrence (2026-09-01)

Maestro cannot open after the chat-core migration lands. Its hidden SQLite renderer reports
`Current version_code 260831132610 is older than migration 260831200000`, and Main rejects the
Maestro activation because `SqliteBootDao.ready()` fails.

This is a build-metadata ordering defect, not database corruption. The shared migration runner
validates the application build against the complete manifest before it reads the migration ledger
or executes SQL, so fresh, historical, and already-shaped Maestro databases are all blocked.

## Earlier repair contract

- Keep the released migration identifier `260831200000` unchanged.
- Advance the canonical `package.json.version_code` to a valid `YYMMDDHHmmss` value newer than the
  latest registered Core and Maestro migration without changing the semantic application version.
- Keep the shared fail-closed build-versus-migration guard intact.
- Extend the real Maestro migration audit to assert the migrated `tasks_json` and `confirm_json`
  columns, so the schema change and version ordering are checked together.
- Do not delete or rewrite the user's Maestro database. A restart after the metadata fix must let
  the existing idempotent migration path upgrade it normally.

## Earlier acceptance

- `yarn audit:sqlite-migrations` accepts the real package build and both production manifests.
- The audit proves fresh and historical Maestro baselines reach the schema containing
  `tasks_json` and `confirm_json`, retain healthy SQLite integrity, and record the expected ledger.
- A focused source review finds no migration-history rewrite or relaxation of the fail-closed
  policy.
- Electron/E2E is left to Ral.

Implementation task:
[maestro-sqlite-build-version-093](../plan/tasks/maestro-sqlite-build-version-093.md).

## Earlier resolution

- Advanced only the canonical `package.json.version_code` to `260901095140`, newer than both
  production SQLite manifests.
- Kept migration `260831200000`, its runner, and the shared fail-closed guard unchanged.
- Extended the real Maestro schema audit to require `tasks_json` and `confirm_json`.
- The complete pure Node migration matrix passed; [review 1](../plan/reviews/maestro-sqlite-build-version-093-1.md)
  found no P0-P2 issues. Electron/E2E remains with Ral.
