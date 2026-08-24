---
id: eyes-on-agents-connections-toggle-065
scope: make the menu-bar bridge glyph toggle the connections drawer instead of only opening it
status: implemented; owner verification pending
depends-on: [eyes-on-agents-connections-drawer-anchor-059]
---

# EyesOnAgents Connections Toggle

## Objective

Clicking the plug glyph in the menu bar opens the Agent connections drawer when it is closed and
closes it when it is open, so the one control that looks like a switch behaves like one.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md) — header behavior
- [Connections drawer anchoring](eyes-on-agents-connections-drawer-anchor-059.md)

Both the connection status pill and the plug glyph emitted the same open-only event, so a second
click on the glyph did nothing while the drawer sat there.

## Required behavior

- The plug glyph emits a toggle intent; the app flips drawer visibility from it.
- The glyph reports `aria-expanded` from the drawer's current state, because it is now a toggle.
- The connection status pill keeps its open-only behavior: it is a status readout that reveals detail,
  not a switch.
- The drawer's own close paths — mask click, `Escape`, its close button — are untouched.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn build`
- Static coverage asserts the toggle emit, the `aria-expanded` binding, the new prop, the app-level
  flip, and that the status pill still only opens.

## Result

Implemented. The bridge button now emits `toggle-connections` and carries
`:aria-expanded="connectionsOpen"`; `EyesOnAgentsMenuBar` takes a `connectionsOpen` prop and `App.vue`
flips `connectionsVisible` from the new event while the status pill keeps `open-connections`.

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents:ui` (70 assertions),
`yarn build`. Electron E2E not run.
