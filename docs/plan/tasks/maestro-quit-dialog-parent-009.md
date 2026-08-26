---
id: maestro-quit-dialog-parent-009
scope: BaseWindow-aware quit-dialog ownership without hidden Home reveal
status: implemented; owner verification pending
depends-on: [maestro-main-shell-004]
verify: node --test tests/maestro/maestroQuitDialogParent.test.mjs && yarn typecheck:node && yarn build && git diff --check
---

# Keep Cmd+Q confirmation on the visible primary window

## Objective

Prevent the hidden legacy Home `BrowserWindow` from appearing when `Cmd+Q` opens the quit
confirmation while Maestro is the authenticated primary window. Resolve dialog ownership across
Electron `BaseWindow` and fail to an unparented dialog rather than selecting a hidden window.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-quit-reveals-hidden-home.md`
- `docs/issues/maestro-startup-host-flash-and-menubar.md`

## Path

- `src/main/dialog/dialog.helper.ts`
- `src/main/dialog/dialogParent.service.ts` (new)
- `src/main/app.main.ts` (lifecycle audit; edit only if the existing call path cannot be preserved)
- `tests/maestro/maestroQuitDialogParent.test.mjs` (new)
- `docs/features/maestro.md`
- `docs/issues/maestro-quit-reveals-hidden-home.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Add a small pure selector that accepts a focused window candidate and the known top-level window
  candidates. Return the focused candidate only when visible and not destroyed; otherwise return
  the first visible, non-destroyed candidate; otherwise return `null`.
- `DialogHelper` obtains candidates through `BaseWindow.getFocusedWindow()` and
  `BaseWindow.getAllWindows()`. It must not use `BrowserWindow.getAllWindows()[0]` or any hidden
  fallback.
- Both quit confirmation and Keychain-access dialogs use the same resolver. With a resolved owner,
  call the parented `dialog.showMessageBox(owner, options)` overload; with `null`, call the
  unparented `dialog.showMessageBox(options)` overload.
- Preserve localized copy, platform-specific button order/default/cancel IDs, confirmation result,
  `app.main.ts` before-quit cancellation/cleanup flow, and update-install behavior.
- Preserve the hidden Home auth/bootstrap runtime. This task fixes visibility only; authentication,
  logout recovery, Todo readiness, Home creation, and Maestro lifecycle are unchanged.

## Verification

- Focused tests execute the pure selector for focused Maestro-like BaseWindow, visible Home,
  hidden-only, destroyed, and empty candidate sets. Source integration checks prove both dialog
  methods use BaseWindow resolution and the unparented overload with no owner.
- Run `yarn typecheck:node`, debug `yarn build`, and `git diff --check`.
- Do not launch Electron, Playwright/E2E, the real application, or packaged smoke. Ral owns final
  `Cmd+Q` visual/runtime acceptance.

## Delivery

- Added a pure visible, non-destroyed dialog-parent selector and moved both quit and Keychain
  message boxes to `BaseWindow` ownership.
- A focused visible owner is preferred; another visible owner is the only fallback. With no safe
  owner, Electron receives the unparented `showMessageBox(options)` overload, so hidden Home cannot
  be revealed by dialog attachment.
- Preserved the existing quit copy, buttons, result mapping, `before-quit` cleanup sequence, update
  handling, and hidden Home authentication/bootstrap responsibilities.
- [Independent review 1](../reviews/maestro-quit-dialog-parent-009-1.md): PASS, no P1/P2/P3
  findings.
- Verification: focused Node tests 6/6, `yarn typecheck:node`, debug `yarn build`, and
  `git diff --check` passed. Electron/E2E/real-app/packaged smoke were not run; Ral owns final
  runtime acceptance.
