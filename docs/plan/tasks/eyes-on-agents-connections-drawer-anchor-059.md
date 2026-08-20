---
id: eyes-on-agents-connections-drawer-anchor-059
scope: anchor the Agent connections drawer inside the board region instead of the whole window
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-only-board-054]
---

# EyesOnAgents Connections Drawer Anchoring

## Objective

Keep the 32px EyesOnAgents menu bar visible and usable while the Agent connections drawer is open by
anchoring the drawer and its mask to the board region (`eyesOnAgents__main`) instead of the document
body.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)

The drawer renders into `body` by default, so its mask covers the menu bar. The window title area,
connection status, Refresh, bridge, and pin controls all disappear behind it.

## Required behavior

- The drawer and its mask render inside the `.eyes-on-agents__main` region and are clipped by it, so
  the menu bar stays fully visible and interactive while the drawer is open.
- The main region is already `position: relative` with `overflow: hidden`; keep it that way as the
  drawer's containing block rather than adding a new wrapper.
- The drawer keeps its existing width, right placement, mask-closable behavior, title, provider rail,
  and internal scrolling. Escape still closes it.
- The drawer must remain usable at the 480px window minimum: its width may not exceed the region,
  so it caps at the available board width.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn build`
- Static coverage asserts the popup container selector and the responsive width cap.

## Result

Implemented. `<a-drawer>` takes `popup-container=".eyes-on-agents__main"`, so the drawer and its
mask render inside the already-`position: relative`, `overflow: hidden` board region and the 32px menu
bar stays visible and clickable while the panel is open. `ConnectionPanel.less` swapped both
`max-width: 100vw` rules for `max-width: 100%` so the 540px drawer caps at the region width instead
of the viewport, which matters at the new 480px window minimum.

Placement, width, mask-closable, Escape, the provider rail, and internal scrolling are unchanged.
`agent-connections-navigation.test.mjs` now asserts the popup container and the `100%` caps.

Follow-up: anchoring alone left the drawer *behind* the board, because Arco replaces its own
`z-index: 1001` with an inline `z-index: inherit` for a container-anchored drawer. Fixed with an
`!important` stacking override plus a real-Arco render guard
(`scripts/eyes-on-agents/connections-drawer-anchor.test.mjs`) — see
[the drawer stacking issue](../../issues/eyes-on-agents-connections-drawer-behind-board.md).

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents:ui`, `yarn build`. E2E not
run; Ral retains the visual check.
