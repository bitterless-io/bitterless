---
id: eyes-on-agents-flex-columns-023
scope: let wrapped EyesOnAgents Domain columns share each row's available width
status: implemented; owner verification pending
depends-on: [eyes-on-agents-all-board-011]
---

# EyesOnAgents Flexible Domain Columns

## Objective

Replace the fixed-width wrapped Domain columns with a 300–500px flex range so complete rows use the
available board width without changing the existing 600px height ceiling or per-column scrolling.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [All and wrapping Domain board](eyes-on-agents-all-board-011.md)

Task 011 records the historical fixed 300px/compact 280px contract. This task supersedes only that
width rule; its projection, ordering, wrapping, drag, and vertical-scroll behavior remains current.

## Required behavior

- Keep one wrapping flex container for Focus, All, and custom Domains.
- Give every Domain a 300px flex basis and minimum, allow it to grow with its row, and cap it at
  500px.
- Remove the compact 280px override so the column contract stays 300–500px at every supported
  standalone-window width.
- Preserve 12px row/column gaps, the 600px column height ceiling, and internal thread-list scrolling.
- Do not add `space-between`: capped final rows may retain trailing canvas space rather than making
  column alignment and drag placement jump between rows.
- Do not launch Electron for verification; Ral performs the visual check.

## Expected paths

- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Static source coverage requires `flex: 1 1 300px`, `min-width: 300px`, and `max-width: 500px`.
- Static source coverage rejects the obsolete fixed basis and 280px compact override.
- Existing wrap, 600px height, and body overflow assertions remain green.

## Result

Implemented the 300–500px flexible Domain width, removed the obsolete compact override, and added a
focused static source guard. Independent review accepted the layout contract; Ral retains Electron
visual verification.

Review: [eyes-on-agents-flex-columns-023-1](../reviews/eyes-on-agents-flex-columns-023-1.md)
