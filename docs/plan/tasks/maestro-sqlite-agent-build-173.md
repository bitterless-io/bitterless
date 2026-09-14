---
id: maestro-sqlite-agent-build-173
scope: fix recurring Maestro SQLite version failures in Agent Build and retire coach SQLite diagnostics
status: implemented; restart verification pending
depends-on: [maestro-sqlite-build-version-093]
verify: build preparation tests, real migration audit, focused type checks, build, independent review; no Electron/E2E
---

# Repair Agent Build SQLite versioning

## Objective

Make a current DEBUG build open the production Maestro migration manifest without a manual release
cut, and use Maestro terminology throughout its SQLite startup/key diagnostics.

## Context

- `docs/issues/maestro-sqlite-build-version-behind-migration.md`
- `docs/features/sqlite-migration-release-gate.md`
- `scripts/before.js`, `scripts/patch.js`, `electron.vite.config.ts`
- `src/preload/common/sqliteMigration.service.ts`

## Path

- `scripts/before.js`, focused build-preparation tests and helpers if needed
- `package.json` (preserve the pre-existing `Bitterless_DEBUG_PROD` name change)
- `src/preload/maestro/sqlite.preload.ts`
- `src/preload/maestro/sqlite/sqliteManager.ts`
- `src/main/maestro/security/sqliteKey.service.ts`
- `scripts/sqlite-migrations/auditRunner.ts` and directly affected verification files
- this task, issue, feature contract, indexes and review

## Contract

- DEBUG preparation stamps the current valid local `YYMMDDHHmmss` string, using `compare-versions`
  for ordering; reject a backwards clock rather than silently downgrading. Same-second preparation
  may reuse the same timestamp. Do not increment `version` or `_version`.
- Release preparation keeps the already-cut version identity; do not change publish ordering,
  channels, release scripts, or migration IDs.
- Both SQLite preloads use the build-defined version; remove Maestro's runtime metadata fallback.
- Replace `[coach sqlite]` with `[maestro sqlite]` in the initialization, manager and key service.
  Existing persistent identifiers and XPC/argument contracts remain compatible; this is not a
  repository-wide API/storage rename.
- Keep the fail-closed guard, database paths, key files, schema history and transaction policy.
- Verify the latest `tabs.kind` / `tabs.instance_id` columns through the real Maestro manifest.
- Preserve unrelated changes and stay on `dev/next`; no branch operations, publishing or app launch.

## Verification

- Focused tests for DEBUG timestamp freshness, repeated/same-second build, backwards-clock refusal,
  release identity preservation, and the embedded preload version.
- `yarn audit:sqlite-migrations`, `yarn test:runtime-profile`, `yarn test:sqlite-migrations`.
- Focused TypeScript and lint checks plus `yarn build` (no app launch). Existing surface typecheck
  runner invokes `npx`; use Yarn/direct compiler instead, preserving the package-manager rule.
- Independent source review and `git diff --check`.
- Do not run Electron, Playwright/E2E, packaged smoke or actual-user database mutation.

## Implementation

- DEBUG preparation uses the local clock and `compare-versions` before writing package metadata;
  the release branch keeps its existing version identity.
- Maestro now consumes the same build-defined version as Core; runtime `app-meta.json` and
  `package.json` reads no longer choose the Maestro migration version.
- SQLite initialization, manager and key-service messages use `[maestro sqlite]`. The existing
  vault smoke-test log filter recognizes the new prefix without changing its runtime behavior.
- Build-preparation tests cover DEBUG freshness, clock rollback, repeat preparation, release
  identity and preload boot behavior. The Maestro audit includes the latest tab column contract
  and historical/current schema baselines.

## Verification results

- `yarn test:runtime-profile`: 18/18 passed, including eight new build/preload cases.
- `yarn test:sqlite-migrations`: 37/37 passed.
- `yarn audit:sqlite-migrations`: 14 Core, 9 Maestro, 10 Todoist sync and 8 Trench cases passed.
- `yarn typecheck:sqlite-migrations`: passed.
- `yarn build`: passed without launching Electron.
- Rebuilt the original selected profile using
  `node scripts/environment/runWithRuntimeProfile.cjs debug_prod -- yarn _build:debug`: passed.
  The final build marker matches restored `debug_prod`; compiled Main uses debug/prod/prod, and
  both SQLite initialization calls embed `260912203727`. Semantic version `0.0.100`, the
  pre-existing `Bitterless_DEBUG_PROD` name and original generated configuration are preserved.
- `git diff --check`: passed.
- Focused direct TypeScript compilation still reports the pre-existing
  `src/shared/onlypreview/onlyPreview.contract.ts:170` TS2339, confirmed against a HEAD source overlay.
- Focused ESLint still reports two pre-existing explicit-return-type errors in `scripts/before.js`
  plus existing formatting warnings. The added test file is lint-clean. These broader checks are
  not claimed as passing; unrelated defects are outside this repair.
- No Electron/E2E, packaged-app smoke or user-database access was performed.

## Human handoff

Ral needs to restart the existing Agent Build and open Maestro to verify the real window lifecycle.
The original terminal entry is `yarn dev:prod` in this project. No Electron acceptance was run by
the agents, in accordance with the workspace rule.

The Chinese handoff was delivered to BotAndI as rendered Markdown after a dry run. Production
Bitterless `domain.list` and `preview.open` both returned a missing MCP bridge socket, so no
acceptance Todo was created and OnlyPreview could not accept this task document. Ral was asked
to start or keep the Production edition running; no DEV/DEBUG or editor substitute was used.

[Independent review 1](../reviews/maestro-sqlite-agent-build-173-1.md): pass, no P1/P2/P3 findings.
The reviewer independently checked the final compiled versions and DEBUG_PROD profile alignment.
