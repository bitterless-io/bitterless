---
id: maestro-window-reopen-retain-runtime-104
scope: Maestro native-close lifecycle and instant singleton reopen
status: implemented; owner verification pending
depends-on: [maestro-hot-reload-home-visibility-012, maestro-workbench-account-logout-097]
verify: node --test tests/maestro/maestroWindowReopenLifecycle.test.mjs && node scripts/maestro/check-embedded-host.mjs && yarn typecheck:node && git diff --check
---

# Preserve Maestro runtime across normal window close

## Objective

Make close-then-open restore the existing Maestro singleton instead of waiting for a complete
authenticated runtime teardown and cold boot.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-window-reopen-cold-boot.md`
- `docs/issues/maestro-hot-reload-reveals-legacy-home.md`
- `docs/issues/maestro-workbench-account-tab-missing.md`

## Path

- `src/main/xpc/maestroWindow.handler.ts`
- `scripts/maestro/check-embedded-host.mjs`
- `tests/maestro/maestroWindowReopenLifecycle.test.mjs`
- `docs/features/maestro.md`
- `docs/issues/maestro-window-reopen-cold-boot.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Native `close` prevents destruction and hides the current Maestro window.
- The live-window branch of `openMaestroWindow()` shows/focuses the preserved singleton immediately;
  it does not enter `boot()`, recreate SQLite, or wait for renderer readiness.
- A real `closed` event still triggers runtime finalization for explicit destruction and exceptional
  native closure.
- `_destroyForAuth()` and `destroyForHostQuit()` retain full teardown. Logout continues to force the
  next boot to pinned Home and closes Workbench before destruction.
- Do not add a timer, polling loop, second window, renderer readiness change, or process-global quit
  flag.

## Verification

- Run the focused lifecycle source regression and existing embedded-host contract.
- Run Node type checking and `git diff --check`.
- Do not launch Electron, Playwright/E2E, the real application, or packaged smoke. Ral owns the
  close/reopen timing and visual acceptance.

## Owner Verification

- Open Maestro, close it with the macOS red light, then restore it from Dock/tray/Mini Apps and
  confirm the existing tab, Workbench, and chat state return immediately.
- Repeat while a browser tab is active and while Workbench is visible.
- Confirm logout still closes Workbench, lands on fixed Home Login, and does not retain authenticated
  state.

## Delivery

- Replaced normal-close teardown with hide while retaining all explicit destruction paths.
- Added focused source guards for hide-on-close, instant singleton reopen, auth teardown, and host
  quit cleanup.
- Focused lifecycle plus related Home/logout regressions passed 11/11; `yarn typecheck:node` and
  `git diff --check` passed.
- The broader `check-embedded-host` script is currently blocked before reaching its host lifecycle
  assertions by pre-existing Maestro host-alias boundary violations in the dirty worktree.
- Electron/E2E was not run; Ral owns runtime verification.
