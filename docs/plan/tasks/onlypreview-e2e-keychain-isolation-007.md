---
id: onlypreview-e2e-keychain-isolation-007
scope: Retain Bitterless full-application E2E without accessing the user's macOS Keychain
status: implemented; owner verification pending
depends-on: [onlypreview-recent-directory-006]
---

# Objective

Keep the existing OnlyPreview and Maestro full-application Electron E2E suites, but make every
macOS test launch use Chromium's mock Keychain and fail before GUI startup if an E2E fixture omits
that isolation switch.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-recent-directory-006.md`

# Path

- `src/main/app.main.ts`
- `tests/e2e/electronLaunchArgs.ts`
- `tests/e2e/electronLaunchArgs.test.mjs`
- `tests/maestro/fixtures/bitterlessApp.fixture.ts`
- `tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-recent-directory-006.md`
- `docs/plan/tasks/onlypreview-e2e-keychain-isolation-007.md`

# Implementation Constraints

1. Add one pure shared launch-argument builder used by every fixture that launches the full
   Bitterless Electron application. On macOS it prepends `--use-mock-keychain` before the
   application path; on Windows it preserves the existing application path and arguments without
   adding a macOS-only switch.
2. Keep the existing `BITTERLESS_E2E=1`, isolated `HOME`, isolated `userData`/`sessionData`, mock
   loopback server, deterministic SQLite test credentials, network guard, and packaged-build
   rejection. Do not weaken production `safeStorage` or add a real credential fallback.
3. In `app.main.ts`, when unpackaged E2E mode runs on macOS, require
   `app.commandLine.hasSwitch('use-mock-keychain')`. Missing isolation must throw before
   `app.whenReady()` and before any GUI/startup integration can access Keychain-backed Chromium
   storage.
4. Retain the OnlyPreview Playwright config, fixture, spec, package command, and all existing test
   coverage. This task changes only the safe launch boundary; it does not delete or reduce E2E.
5. Add pure Node/source tests for argument order, platform behavior, both fixture integrations, and
   the pre-ready fail-fast guard. Tests must not launch Electron, Playwright, Bitterless, or access
   Keychain.
6. Do not modify or stage unrelated Coin/Trench work or the existing `package.json` DEBUG-name
   change.

# Verification

- Pure Node tests for the shared launch-argument builder and source guards
- Static review of both `_electron.launch` call sites and Main startup ordering
- `git diff --check`
- Do not run Electron, Playwright, the full Bitterless application, or the E2E package scripts in
  this delivery. Ral will execute the retained E2E suite after reviewing the isolation change.

# Delivery Evidence

- Implemented on 2026-08-08. Both full-application fixtures now build their Electron arguments
  through one pure helper: macOS places `--use-mock-keychain` before the Bitterless application
  path, while Windows retains the existing application path and following arguments unchanged.
- Main now rejects an unpackaged macOS `BITTERLESS_E2E=1` process without the mock-Keychain switch
  before `app.whenReady()`. Helper processes and the existing packaged-E2E rejection remain
  unchanged.
- `node --test tests/e2e/electronLaunchArgs.test.mjs` passed 2/2 tests, and
  `node --test tests/onlypreview/*.test.mjs` passed 46/46 pure Node/source tests. The source guard
  proves both `_electron.launch` integrations and the pre-ready Main ordering.
- `yarn typecheck:node`, focused error-level ESLint, and `git diff --check` passed. Existing
  unrelated `no-empty`, `no-empty-pattern`, and `no-unsafe-finally` fixture diagnostics were
  excluded from the focused ESLint gate.
- Electron, Playwright, the full Bitterless application, E2E package commands, and `yarn build`
  were not run by explicit delivery instruction. Ral owns the retained E2E execution after review.
