---
id: maestro-hot-reload-home-visibility-012
scope: Maestro primary-window ownership and hidden legacy Home runtime
status: implemented; owner verification pending
depends-on: [maestro-startup-chrome-005]
verify: node --test tests/maestro/maestroLegacyHomeVisibility.test.mjs && yarn test:customer-auth && yarn typecheck:node && yarn build && git diff --check
---

# Make Maestro the sole visible primary

## Objective

Make Maestro the only visible primary window. Keep the legacy Home renderer alive only as a hidden
compatibility/auth/Todo runtime, and ensure no HMR, startup, activation, login, logout, or invalidation
path can reveal its native `BrowserWindow`.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-hot-reload-reveals-legacy-home.md`
- `docs/issues/maestro-startup-host-flash-and-menubar.md`
- `docs/plan/tasks/maestro-startup-chrome-005.md`

## Path

- `src/main/xpc/auth.handler.ts`
- `src/main/app.main.ts`
- `src/main/windows/mainWindow.helper.ts`
- `src/renderer/home/src/xpc/auth.subscriber.ts` (preserve route-before-deactivate ordering)
- `tests/maestro/maestroLegacyHomeVisibility.test.mjs` (new)
- `scripts/auth/customer-authentication.test.mjs` (compatibility verification; edit only when the
  maintained source guard requires the new explicit state)
- `docs/features/maestro.md`
- `docs/issues/maestro-hot-reload-reveals-legacy-home.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Cold startup opens Maestro immediately after creating the hidden Home runtime.
- Tray, Dock activation, second-instance activation, `showPrimaryWindow()`, and the compatibility
  `showHomeWindow()` call all open/focus Maestro and defensively hide legacy Home.
- Authentication activation may prepare authenticated runtimes, but authentication state never
  chooses which native primary window is visible. Activation failure has no Home-window fallback.
- Logout and invalidation may tear down authenticated runtimes; after teardown they reopen Maestro
  rather than revealing Home or leaving the app without a primary window.
- `mainWindowHelper` remains `showOnReady = false`, is absent from the taskbar, and has no source call
  to `show()`. It continues hosting existing Home renderer/XPC/token/Todo compatibility behavior.
- Keep the existing Maestro singleton/readiness gates and fixed local-Home miniapp. Do not add a
  second state machine, recovery token protocol, timer, polling loop, or duplicate window.

## Verification

- Add executable/source regression coverage for Maestro ownership across cold start, activation
  sources, authentication, logout, and invalidation, plus the hidden-only Home helper contract.
- Run the focused test, the existing customer-auth source/behavior suite, `yarn typecheck:node`,
  debug `yarn build`, and `git diff --check`.
- Do not launch Electron, Playwright/E2E, the real application, or packaged smoke. Ral owns HMR and
  visual acceptance.

## Owner Verification

- While signed in with Maestro visible, edit renderer code and Main code separately to trigger both
  HMR modes; confirm no legacy Home/New Chat frame appears.
- Repeat Dock, tray, and second-instance activation during reload.
- Verify signed-out startup, failed/cancelled persisted-session recovery, logout, and invalidation
  leave Maestro as the visible primary and never expose the legacy Home frame.

## Delivery

- Implemented the single-visible-primary rule without adding a visibility/recovery state machine.
- Kept legacy Home as a hidden renderer/XPC runtime and preserved detached debug DevTools.
- Verified with the focused 4/4 regression, customer-auth 20/20, `yarn typecheck:node`, debug
  `yarn build`, and `git diff --check`.
- Electron, Playwright/E2E, real-app HMR, and packaged smoke were not run; Ral owns visual
  acceptance.
