---
id: eyes-on-agents-focus-activation-tint-061
scope: tint the Focus surface pale orange while the window is active and neutral grey while it is not
status: superseded by eyes-on-agents-flat-board-surface-064
depends-on: [eyes-on-agents-focus-search-toggle-058]
---

# EyesOnAgents Focus Activation Tint

## Objective

Bring back the pale orange Focus surface, but as a window-activation state: warm while the
EyesOnAgents window is the active window, neutral grey while it is not.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Focus search toggle](eyes-on-agents-focus-search-toggle-058.md) — removed the tint outright; this
  task partially reverses that decision

## Required behavior

- Restore the `--eyes-column-focus: oklch(0.94 0.04 60)` token. The Focus column paints it while the
  window is active and falls back to the neutral `--eyes-column` while the window is inactive.
- Activation state is renderer-local and transient: `focus` and `blur` on `window`, seeded from
  `document.hasFocus()` so a window that starts inactive renders grey immediately.
- The state lives on the renderer root as one modifier class; the column reads it through a
  descendant selector rather than a new prop, store field, or IPC round trip.
- The existing activation `focus` listener keeps driving the metadata refresh; the tint must not add
  a second refresh, an IPC call, or a timer.
- The Omni-hosted renderer stays warm: an embedded cell can sit blurred while its host window is
  active, so activation tracking applies to the standalone window only.
- Nothing else changes: no attention tint on any other surface, and the card, header, and hierarchy
  treatments stay as delivered.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/App.less`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn build`
- Static coverage asserts the restored token, the active/inactive surfaces, the seeded
  `document.hasFocus()` state, symmetric `blur` listener registration and removal, and the Omni
  exemption.

## Result

Superseded by [task 064](eyes-on-agents-flat-board-surface-064.md): the owner removed the Focus
surface entirely, and this tint had no other host, so the token, the modifier class, and the
`windowActive` flag with its `blur` listener were all removed again. The record below is historical.

Implemented. `--eyes-column-focus: oklch(0.94 0.04 60)` is back in `App.less`, `.agent-domain` paints
it by default, and `.eyes-on-agents--inactive .agent-domain` falls back to `--eyes-column`.

`App.vue` owns the state: `windowActive = ref(isOmni || document.hasFocus())`, set true in the
existing `focus` handler and false in a new `blur` handler, both no-ops under Omni. The root element
carries `eyes-on-agents--inactive` when the flag is false. The `focus` handler still triggers exactly
one metadata refresh — the tint added no IPC, timer, or second refresh — and the `blur` listener is
registered and removed symmetrically with the others.

Task 058 removed this tint outright; that decision is now narrowed rather than reverted — the warm
surface signals "this window is the one you are working in".

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents:ui` (67 assertions),
`yarn build`. Electron E2E not run; Ral retains the visual check on activate/deactivate.
