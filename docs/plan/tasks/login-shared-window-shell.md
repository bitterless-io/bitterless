---
id: login-shared-window-shell
scope: Shared desktop window shell for public and authenticated routes
status: done
depends-on: [customer-account-recovery]
---

# Login Shared Window Shell

## Objective

Render the existing HomeView `MenuBar` once above every home-renderer route so the login page keeps
the same draggable status bar, platform window controls, proxy indicator, and clickable
restart-to-update action as the authenticated workspace. Remove the login-only drag overlay and make
both login and authenticated layouts size themselves inside the shared routed-content region.

## Context

- `docs/design/customer-authentication.md`
- `docs/design/colors.md`
- `docs/plan/tasks/customer-account-recovery.md`

## Path

- `src/renderer/home/src/App.vue`
- `src/renderer/home/src/App.less`
- `src/renderer/home/src/views/layout/Layout.vue`
- `src/renderer/home/src/views/layout/Layout.less`
- `src/renderer/home/src/views/login/Login.vue`
- `src/renderer/home/src/views/login/Login.less`
- `docs/design/customer-authentication.md`
- `docs/plan/README.md`
- `docs/plan/tasks/login-shared-window-shell.md`

## Verification

- `MenuBar` has one owner in `App.vue` and is visible on both `/login` and `/chat`; `Layout.vue`
  retains only authenticated sidebar/content concerns.
- When `updateStore.updateAvailable` is true on `/login`, `Restart to Update` is visible and calls
  the existing `restartAndUpdate` action; Windows window controls remain clickable.
- The login page has no fixed drag overlay and cannot cover MenuBar actions.
- `/login` remains public, authentication redirects and invited first-password setup remain
  unchanged, and authenticated routes still render `HomeMenu` plus their routed content.
- At `800x600` and `1200x800`, the shared bar stays 32px high and login/workspace content fits the
  remaining height without whole-window overflow.
- `yarn build`, `yarn typecheck:node`, focused lint, and `git diff --check` pass; any pre-existing
  `typecheck:web` failures are reported separately from touched files.
