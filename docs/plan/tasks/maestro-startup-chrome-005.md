---
id: maestro-startup-chrome-005
scope: authenticated-primary startup visibility and Omni-derived Maestro chrome
status: implemented; owner verification pending
depends-on: [maestro-main-shell-004]
verify: source audit and independent review only; Ral owns Electron/runtime visual acceptance
---

# Remove the BitterLess startup flash and align Maestro chrome

## Objective

Keep Bitterless Home hidden during valid persisted-session recovery so the first automatically
shown application window is the fully ready Maestro primary window. Preserve Home as the explicit
login/recovery fallback, and adapt Maestro's top tab strip from the current Omni Browser MenuBar:
44px high, Royal Blue chrome, and vertically centered native macOS controls.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-startup-host-flash-and-menubar.md`
- `docs/design/customer-authentication.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/plan/tasks/maestro-main-shell-004.md`

## Path

- `src/main/windows/mainWindow.helper.ts`
- `src/main/xpc/auth.handler.ts`
- `src/main/xpc/maestroWindow.handler.ts`
- `src/renderer/home/src/views/login/Login.vue`
- `src/main/maestro/windows/window.helper.ts`
- `src/main/maestro/windows/main/maestroWindow.controller.ts`
- `src/main/maestro/xpc/coach.handler.ts`
- `src/shared/maestro/coach.api.ts`
- `src/renderer/maestro/home/src/main.ts`
- `src/renderer/maestro/home/src/components/MenuBar/{MenuBar.vue,MenuBar.less}`
- `docs/{features,issues,plan}/**`

## Contract

- Disable Home's automatic `ready-to-show` reveal. Entering the public Login route explicitly
  reveals Home; valid persisted-session startup never mounts Login and therefore keeps Home hidden.
- Keep the existing ordering in `AuthHandler`: show Maestro successfully first, then hide Home.
  Failure must show Home; stale activation generations must not reveal either stale primary.
- Add bounded SQLite and Maestro window readiness. A timeout follows the existing boot catch path,
  destroys partial Maestro state, and reaches the AuthHandler Home fallback.
- Add a renderer-to-main Home mount fence after main-owned locale initialization, Vue mount, and a
  render tick. Maestro's initial readiness includes this fence before `openMaestroWindow()` may
  call `show()`.
- Preserve the existing renderer-measured operation/Control bounds and address-row geometry.
- Set the top tab strip to 44px (`Omni 32px + 12px`), total MenuBar to 92px, macOS traffic lights to
  `{ x: 12, y: 14 }`, and macOS left content gutter to 78px.
- Reuse Omni's `#4e5882` surface and `#3d4666` divider. Retain Maestro's active/pinned/browser tab
  semantics, visible capture/debugger/workbench/update actions, focus states, and reduced-motion
  behavior.

## Verification

- Independent source review verifies the startup ownership chain, timeout/fallback path, mount
  readiness fence, exact 44/48/92px geometry, traffic-light position, and native-view bounds owner.
- `git diff --check` must pass for task-owned files.
- Per the current Maestro consolidation verification contract, do not run tests, type checks,
  builds, Electron, Playwright/E2E, AI-CRMS, network, or packaged-app smoke in this delivery.
- Ral verifies the persisted-session first frame, signed-out/failure fallback, Omni comparison, and
  macOS native-control alignment in the real app.

## Delivery

- Source implementation completed on 2026-08-25.
- Independent source review approved with no remaining P0-P2 findings:
  [maestro-startup-chrome-005-1](../reviews/maestro-startup-chrome-005-1.md).
- `git diff --check` passed. Runtime, automated, Electron, and network verification were not run by
  design; Ral owns the real-app acceptance above.
