# Review: Maestro Agent Build SQLite 173

Date: 2026-09-12

Task: [maestro-sqlite-agent-build-173](../tasks/maestro-sqlite-agent-build-173.md)

## Findings

No P1/P2 blocking findings or P3 non-blocking findings in the task-scoped change.

## Contract and integration evidence

- **DEBUG clock and release identity:** the feature contract at
  `docs/features/sqlite-migration-release-gate.md:28` is implemented by
  `scripts/before.js:34`: invalid existing metadata fails before any output write; DEBUG uses a
  valid local `YYMMDDHHmmss` timestamp and `compareVersions`, permits the same second, and rejects
  rollback. Release preparation does not enter that branch. The semantic-version assignment and
  release-cut script remain unchanged. `scripts/environment/buildPreparation.test.mjs:90` covers
  both DEBUG profiles, the local midnight boundary with `TZ=Asia/Shanghai`, rollback without
  writes, invalid metadata, and all three release profiles with earlier/later clocks.
- **Real version injection:** package scripts run `before.js` before Electron Vite for both DEBUG
  build and dev. `electron.vite.config.ts:37` reads the prepared package value, line 452 applies
  its definition to the real preload build, and lines 458/477 include both SQLite entry points.
  `src/preload/maestro/sqlite.preload.ts:39` now passes that definition directly, matching Core.
  The isolated preload test covers success/failure readiness and token handling; its mocked
  native/XPC dependencies are not treated as proof of full application startup.
- **Final compiled artifacts:** independent read-only assertions passed for package
  `version_code=260912203727`, `version=_version=0.0.100`, and the pre-existing
  `Bitterless_DEBUG_PROD` name. The selected canonical profile and
  `out/.bitterless-runtime-profile.json` agree on `debug_prod` / `debug` / `prod` / `prod`.
  `out/preload/maestroSqlite.js:370` and `out/preload/sqlite.js:77807` both pass
  `260912203727` to initialization. Neither retains the undefined build symbol; Maestro no longer
  contains the old timestamp, `app-meta.json` fallback, or `[coach sqlite]` prefix. This checks the
  actual Electron Vite result in addition to the isolated test's manually supplied definition.
- **Migration and preserved data:** the audit imports the runtime manifest at
  `scripts/sqlite-migrations/auditRunner.ts:23`; migration `260911140000` remains unchanged at
  `src/preload/maestro/sqlite/maestroSqlite.release.ts:335`. New fixtures at audit lines 838/839
  represent the immediately preceding chat schema and the latest tab schema. Lines 990/1005
  verify both tab columns, exact legacy tab fields and defaults, and existing nonempty composite
  identity. Lines 1055/1065 verify the real pending manifest entries; lines 1076/1084 verify no
  repeat migrations or ledger changes on the subsequent migration pass. Fresh, pre-ledger and
  older checkpoints retain coverage, including integrity and foreign-key checks.
- **Diagnostics and compatibility:** task contract lines 41–44 are satisfied by the prefix-only
  changes in `src/preload/maestro/sqlite/sqliteManager.ts` and
  `src/main/maestro/security/sqliteKey.service.ts`, plus the preload changes. The diagnostic
  consumer in `tests/coin/specs/trench-vault.spec.ts:275` recognizes the new name. Existing
  `--coach-userdata`, `--coach-sqlite-bootstrap-file`, XPC names, database paths and key filenames
  remain compatible. The shared manifest guard and per-migration transaction policy have no diff.

## Verification and limits

The developer's recorded results were reviewed without repeating unchanged suites:

- `yarn test:runtime-profile`: 18/18 passed.
- `yarn test:sqlite-migrations`: 37/37 passed.
- `yarn audit:sqlite-migrations`: 14 Core, 9 Maestro, 10 Todoist sync and 8 Trench cases passed.
- `yarn typecheck:sqlite-migrations`: passed.
- `yarn build`: passed; the subsequent
  `node scripts/environment/runWithRuntimeProfile.cjs debug_prod -- yarn _build:debug` also passed
  and produced the final artifacts inspected above.

This independent review inspected the complete task-scoped diff, including the untracked
`scripts/environment/buildPreparation.test.mjs`, the real call/configuration paths and final
compiled files. Its package/profile/compiled-output assertions and `git diff --check` passed.
The current branch was confirmed as `dev/next`; no branch operation was performed.

Focused broader TypeScript compilation remains limited by the reported pre-existing
`src/shared/onlypreview/onlyPreview.contract.ts:170` TS2339. Focused ESLint retains two reported
pre-existing explicit-return-type errors in `scripts/before.js` and formatting warnings. The
developer verified those errors with a HEAD overlay; this review does not claim those broader
checks passed or repeat the overlay. The new test file was reported lint-clean.

No Electron/E2E, packaged application smoke, SQLCipher file opening, or real user database
operation was performed. The pure-Node migration audit proves schema/ledger behavior on
disposable databases; the repeated audit pass uses the same open adapter and does not establish
a native process restart. Actual application activation remains an owner verification step.

## Conclusion

**pass** — the task-scoped repair meets its documented contract and has no blocking finding.
