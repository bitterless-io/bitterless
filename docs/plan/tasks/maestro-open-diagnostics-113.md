---
id: maestro-open-diagnostics-113
scope: Privacy-safe correlated timing for every Maestro main-window open route
status: implemented; owner packaged verification pending
depends-on: [maestro-window-reopen-retain-runtime-104, application-diagnostics-010]
verify: node --test tests/maestro/maestroOpenDiagnostics.test.mjs tests/maestro/maestroWindowReopenLifecycle.test.mjs && yarn typecheck:node && git diff --check
---

# Trace Maestro open to the visible ready window

## Objective

Make intermittent slow or failed Maestro opens diagnosable from `main.log` without changing window
lifecycle or exposing renderer/session data.

## Context

- `docs/features/maestro.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/maestro-window-reopen-cold-boot.md`

## Path

- `src/main/xpc/maestroWindow.handler.ts`
- `src/main/windows/maestroWindow.controller.ts`
- a Main-only diagnostics helper under `src/main/maestro/`
- `tests/maestro/`

## Contract

- Emit allowlisted `[maestro-open]` records through the existing Main logger. Do not introduce a
  second file logger.
- Give each request a short process-local open ID and each cold boot a boot ID. Concurrent requests
  joining one boot share that boot ID.
- Distinguish `reuse`, `join-boot`, and `cold-boot`, including cleanup wait before route selection.
- Cold boot records fixed stages for runtime/proxy setup, SQLite window load, SQLite preload ready,
  session read, controller construction, Shell load, Home mounted, pinned Home/startup tab, Control,
  Workbench, all-ready, show, and terminal result. A timeout/failure terminal record reports only a
  fixed reason and fixed pending-stage names.
- Use monotonic, clamped integer elapsed/stage milliseconds. Do not log URLs, paths, tab/session
  identities, webContents IDs, tokens, raw errors/objects, or renderer-owned values.
- Logging is best-effort, bounded to meaningful milestones, and cannot alter the existing readiness
  promises, 30-second deadline, hide/reuse behavior, or cleanup.

## Verification

- Pure fake-clock/writer tests cover allowlists, timing clamp, IDs, join correlation, terminal
  once-only behavior, privacy-field dropping, and writer failure.
- Lifecycle source regression covers reuse, join, cold boot, stage/terminal records, and unchanged
  hide/destroy paths.
- Run focused Node tests, Node type checking, and `git diff --check`.
- Do not launch Electron, Playwright/E2E, packaged smoke, or the real app. Ral owns live acceptance.

## Owner verification

- Package/run Preview and perform a normal hide/reopen plus a cold start.
- Filter `Bitterless_PREVIEW/main.log` by `[maestro-open]`; confirm each request has one route and
  terminal record and cold boot shows which renderer/readiness stage dominates.
- Confirm no URL, title, account/session value, token, or local path appears in those records.

## Delivery

- Added one Main-only allowlisted diagnostic service with short request/boot IDs, monotonic clamped
  durations, once-only terminal records, and best-effort clock/writer behavior.
- Instrumented cleanup wait plus reuse, joined boot, and cold boot; cold boot stages cover runtime,
  proxy, SQLite window/preload, session, controller, Shell, Home mount, pinned/startup tabs,
  Control, Workbench, all-ready, show, and terminal pending state.
- Preserved the controller `create(): BrowserWindow` signature and every existing 30-second
  readiness, hide/reuse, auth, host-quit, and cleanup path.
- Fake-clock/writer/privacy/lifecycle tests passed 8/8; `yarn typecheck:node`, the Maestro CLI
  integration check, and `git diff --check` passed. Electron/E2E/packaged runtime were not run.
- [Independent review 1](../reviews/maestro-open-diagnostics-113-1.md) passed with no P0-P3 finding.
