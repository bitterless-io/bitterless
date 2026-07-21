---
id: sqlite-migration-release-gate-001
scope: strict Core, Maestro, and Todoist-sync SQLite upgrade audit before all production packages
status: pending
depends-on: [todoist-sync-desktop-001]
---

# SQLite Migration Release Gate

## Objective

After `todoist-sync-desktop-001` has supplied the Todo manifest and audit registration, run the
combined three-family fail-closed audit and verify the contract in
`docs/features/sqlite-migration-release-gate.md`. Release one production version to macOS ARM64,
macOS x64, and Windows x64 only if every gate passes.

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
- Todoist sync matrix imports the production manifest and covers fresh/current-v1, an invalid or
  incomplete ledger, rollback of an injected future migration, sentinel preservation,
  `integrity_check`, and `foreign_key_check`;
- Electron-ABI Todo cipher smoke proves encrypted create/reopen, wrong-key failure, customer-path
  isolation, and that development plus packaged macOS/Windows outputs resolve the production
  `better-sqlite3-multiple-ciphers` native module;
- Todo database tests inject a fixed test password and prove they never touch Electron
  `safeStorage`/the operating-system keychain; no legacy `main.db` Todo import is attempted;
- `yarn typecheck:node`
- `yarn test:eyes-on-agents:repository`
- production build hook source test proves audit runs before any build/sign/publish step;
- macOS publisher tests prove DMG signing uses a disposable explicit keychain, restores the exact
  prior user keychain search list on success and failure, selects the app-team identity, verifies
  the signed artifact, and does not log certificate/keychain passwords;
- macOS build tests prove per-file codesign retries only the exact transient Apple timestamp
  service failure with bounded backoff, while permanent and non-codesign failures remain immediate;
- `git diff --check`;
- process audit proves no audit/test/Electron helper remains;
- after code sync, production release and public manifest/artifact verification pass for
  `mac_arm`, `mac_intel`, and `win64`.

## Ownership boundary

The existing Core/Maestro shared runner, audit CLI, and packaging hook are the already-present
foundation. `todoist-sync-desktop-001` alone owns the new Todo runtime manifest, fixed-password
fixtures, native cipher smoke, and registration into that foundation. This task starts only after
that dependency and owns the final combined audit/package/publication proof; it must not redesign
or duplicate the Todo manifest.
