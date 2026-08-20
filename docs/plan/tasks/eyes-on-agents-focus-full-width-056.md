---
id: eyes-on-agents-focus-full-width-056
scope: let the Focus column fill the board width and lower the EyesOnAgents window minimum width to 480px
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-only-board-054]
---

# EyesOnAgents Full-Width Focus Column

## Objective

Replace the fixed 300px Focus column with one that fills the whole board width, and lower the
standalone EyesOnAgents window minimum width from 800px to 480px so the board stays usable as a
narrow side panel.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Focus-only board delivery](eyes-on-agents-focus-only-board-054.md)

Task 054 pinned the column at the previous 300px minimum on the owner's instruction. The owner
revised that after seeing it: the column must stretch instead, and the window must be allowed to get
much narrower.

## Required behavior

- The Focus column has no maximum width and no fixed width: it fills the board's content box at
  every window size, keeping the board's 12px padding and the column's full available height.
- The standalone EyesOnAgents `BrowserWindow` uses `minWidth: 480`. `minHeight` stays 600 and the
  1120 × 720 default is unchanged.
- This is a deliberate documented exception to the project-wide `minWidth: 800` window rule; record
  it so a later cleanup does not revert it.
- The 32px menu bar must not overflow at 480px: the identity block may shrink and ellipsize its
  title so the connection, Refresh, bridge, and pin controls stay reachable.
- Nothing else changes — comparator, membership, `Read all`, filters, `Cmd+F`, and card behavior stay
  exactly as delivered by tasks 054 and 055.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/main/xpc/eyesOnAgentsWindow.handler.ts`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.less`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn build`
- Static source coverage asserts `minWidth: 480`, `minHeight: 600`, a stretching column with no
  `max-width`/fixed `width`, and a shrinkable menu-bar identity.

## Result

Implemented. `.agent-domain` is now `width: auto`, `min-width: 0`, `flex: 1 1 auto`,
`height: 100%` with no `max-width` or `max-height`, so it fills the board box. The standalone window
uses `minWidth: 480` with an inline comment naming this task, and `minHeight` stays 600.

The menu-bar identity became shrinkable (`min-width: 0`, `flex: 0 1 auto`, ellipsized title) and the
action cluster `flex: 0 0 auto`, so at 480px the connection, Refresh, bridge, and pin controls stay
reachable.

The workspace rule that mandates `minWidth: 800` for every BrowserWindow now records this exception
in both `CLAUDE.md` and `AGENTS.md`, so a later cleanup will not revert it.

A follow-up defect surfaced from this change and is fixed separately in
[the narrow-window reflow issue](../../issues/eyes-on-agents-narrow-window-no-reflow.md): the
renderer root still carried the old 800px floor.

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents:ui`, `yarn build`. E2E not
run; Ral retains the visual check.
