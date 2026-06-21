---
id: startup-resource-and-migration-repair
scope: startup
status: done
depends-on:
  - release-oss-publish-script
---

# Startup Resource And Migration Repair

## Objective

Remove the Chromium zip startup resource gate and make todo/domain schema upgrades resilient for existing local databases.

## Findings

- The startup modal is controlled by `extraResource.checkNeedsExtract()` and `extraResource.startExtract()`.
- Chromium zip resources are no longer required and should not block app startup.
- The current packaged mac app does not contain `app.asar.unpacked/chrome-macarm.zip`; the correct fix is to remove this startup dependency, not to restore the zip.
- Existing DBs can miss newly used todo/domain columns if migration state is ahead of the actual table schema.

## Plan

- Remove the Home startup call that opens the resource preparation modal.
- Keep the `extraResource` preload API as a no-op for compatibility.
- Remove Chromium zip copy/extract work from `scripts/before.js`.
- Add a repair migration that checks real table columns and adds missing todo/domain columns idempotently.

## Verification

- `node -c scripts/before.js`
- `git diff --check`
- `node scripts/before.js`
- `yarn build`
- SQLite CLI migration simulation for missing `todos.source` and `domain.description`

## Result

- Home startup no longer checks or extracts Chromium zip resources.
- `extraResource` remains available as a no-op compatibility API.
- `scripts/before.js` no longer copies or validates Chromium zip files.
- SQLite migration now supports function runners.
- Existing DBs without migration rows are treated as old DBs instead of new DBs.
- Added repair migration `26062002`, which idempotently adds:
  - `todos.source`
  - `domain.description`
  - `domain.archived`

## Notes

- `NODE_OPTIONS=--max-old-space-size=8192 yarn typecheck:node` was stopped after several minutes without output; the default heap run previously hit Node OOM. `yarn build` passed and covers the changed preload/main bundling path.
