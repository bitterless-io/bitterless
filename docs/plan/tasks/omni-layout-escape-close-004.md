---
id: omni-layout-escape-close-004
scope: keyboard dismissal and visibility synchronization for the top-level Omni Layout control
status: implemented; owner verification pending
depends-on: [omni-miniapp-cells-001, omni-layout-axis-collapse-002]
---

# Omni Layout Escape Close

## Objective

When the top-level Omni Browser Layout control is open, pressing `Escape` anywhere inside its
Control `WebContentsView` closes the control and clears the active state on the Menu Bar Layout
button. Repeated or late close attempts remain harmless.

## Interaction contract

- Capture `Escape` at the Main-owned Control webContents boundary so focused Arco inputs and selects
  cannot prevent the top-level dismissal.
- Close only the Layout Control overlay. Do not close the Omni BaseWindow, a cell, a browser page,
  or an embedded mini app.
- Main remains authoritative for visibility and broadcasts the resulting state to the top-level
  Omni Menu Bar.
- Existing click-to-open/click-to-close behavior, layout persistence, colors, typography, geometry,
  and child-window ownership remain unchanged.

## Path

- `src/shared/omni/omni.types.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/renderer/omni/omniWindow/src/App.vue`
- `tests/omni/omniLayoutLifecycle.test.mjs`
- `docs/features/omni-miniapp-cells.md`

## Verification

- Source contract proves the Control view captures `Escape`, prevents its default action, closes
  idempotently, and broadcasts the resulting visibility.
- Source contract proves the top-level Menu Bar consumes the Main-owned visibility event.
- `node --test tests/omni/omniLayoutLifecycle.test.mjs`
- Focused TypeScript and lint checks for changed modules.
- `git diff --check`

Electron launch and live keyboard acceptance remain with Ral.

## Delivery evidence — 2026-08-07

- Main captures Control `keyDown` for `Escape`, prevents the nested control action, and closes only
  the Layout Control view through the idempotent visibility setter.
- Main broadcasts the resulting visibility and the top-level Omni Menu Bar consumes it, keeping the
  Layout button active state aligned after keyboard dismissal.
- Omni lifecycle passed 10/10; focused Node typecheck passed; changed-source ESLint passed with no
  errors and retained existing Prettier warnings in the legacy files.
- Full Web typecheck remains blocked by pre-existing Connector, Poker, Chat, path-helper, and alias
  diagnostics; it reported no new visibility-event or Escape-close diagnostic.
- Electron was not launched. Ral retains live keyboard acceptance.
