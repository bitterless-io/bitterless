# Maestro startup is blocked by a migration newer than the app build

Status: implemented; owner verification pending

## Observed behavior

Maestro cannot open after the chat-core migration lands. Its hidden SQLite renderer reports
`Current version_code 260831132610 is older than migration 260831200000`, and Main rejects the
Maestro activation because `SqliteBootDao.ready()` fails.

This is a build-metadata ordering defect, not database corruption. The shared migration runner
validates the application build against the complete manifest before it reads the migration ledger
or executes SQL, so fresh, historical, and already-shaped Maestro databases are all blocked.

## Required behavior

- Keep the released migration identifier `260831200000` unchanged.
- Advance the canonical `package.json.version_code` to a valid `YYMMDDHHmmss` value newer than the
  latest registered Core and Maestro migration without changing the semantic application version.
- Keep the shared fail-closed build-versus-migration guard intact.
- Extend the real Maestro migration audit to assert the migrated `tasks_json` and `confirm_json`
  columns, so the schema change and version ordering are checked together.
- Do not delete or rewrite the user's Maestro database. A restart after the metadata fix must let
  the existing idempotent migration path upgrade it normally.

## Acceptance

- `yarn audit:sqlite-migrations` accepts the real package build and both production manifests.
- The audit proves fresh and historical Maestro baselines reach the schema containing
  `tasks_json` and `confirm_json`, retain healthy SQLite integrity, and record the expected ledger.
- A focused source review finds no migration-history rewrite or relaxation of the fail-closed
  policy.
- Electron/E2E is left to Ral.

Implementation task:
[maestro-sqlite-build-version-093](../plan/tasks/maestro-sqlite-build-version-093.md).

## Resolution

- Advanced only the canonical `package.json.version_code` to `260901095140`, newer than both
  production SQLite manifests.
- Kept migration `260831200000`, its runner, and the shared fail-closed guard unchanged.
- Extended the real Maestro schema audit to require `tasks_json` and `confirm_json`.
- The complete pure Node migration matrix passed; [review 1](../plan/reviews/maestro-sqlite-build-version-093-1.md)
  found no P0-P2 issues. Electron/E2E remains with Ral.
