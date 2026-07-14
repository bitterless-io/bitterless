---
id: cowork-subapp-002
scope: Cowork parity checks and Bitterless-launched Electron E2E
status: done
depends-on: [cowork-subapp-001, cowork-subapp-003]
verify:
  - source Cowork parity checks run against the embedded namespace
  - Playwright opens Cowork through Bitterless Mini Apps
  - repeated Open focuses the same Cowork instance
  - closing Cowork leaves Bitterless and Todo usable
  - all Cowork render surfaces load without fatal console errors
---

# Verify Embedded Cowork Parity

## Objective

Adapt the upstream Cowork static/smoke checks and Electron baseline so they exercise the embedded
runtime, then add an end-to-end flow that launches Bitterless, enters Mini Apps, opens Cowork, and
verifies singleton/focus and window-graph behavior.

## Context

- `docs/features/cowork-subapp.md`
- `docs/plan/analysis/cowork-subapp-migration.md`
- `docs/plan/tasks/cowork-subapp-001.md`
- Source checks: `../micromeet-cowork/apps/cowork/scripts/check-*.mjs`
- Source E2E: `../micromeet-cowork/apps/cowork/tests/e2e/`

## Path

- `docs/plan/tasks/cowork-subapp-002.md`
- `scripts/cowork/**`
- `tests/cowork/**`
- `src/main/app.main.ts`
- `src/main/updateHelper/update.service.ts`
- `package.json`
- `yarn.lock`

## Verification

- Run every migrated Cowork check that does not require live customer credentials or mutate remote
  systems; list credential/live-service checks as explicit manual gates.
- Run the Bitterless-launched Playwright Cowork baseline in an isolated temporary user-data profile.
- `BITTERLESS_E2E=1` must set an isolated Bitterless `userData` path before `app.whenReady()`, skip
  updater network/download work, and bypass the macOS quit dialog while still running cleanup.
- Mock Home authentication and AI-CRMS page loading locally; reject unknown HTTP(S) requests. Do not
  add a production authentication bypass.
- Run `yarn typecheck`, `yarn build`, and `git diff --check` after the test wiring is complete.
