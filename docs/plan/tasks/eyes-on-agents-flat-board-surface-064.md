---
id: eyes-on-agents-flat-board-surface-064
scope: flatten the Focus surface, move the board inset to the region, and take button/input colors from theme.ts
status: implemented; owner verification pending
depends-on: [eyes-on-agents-manual-read-state-063]
---

# EyesOnAgents Flat Board Surface

## Objective

Drop the Focus column's own surface and padding so cards sit on the board canvas, keep one inset on
the board region instead, and pull the text-action colors — `Read all`, text-button hover, the search
field — from `theme.ts` rather than ad-hoc `oklch()` values.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Focus activation tint](eyes-on-agents-focus-activation-tint-061.md) — **superseded by this task**:
  the tint painted the very surface being removed
- `theme.ts` — the Arco palette this borrows from

## Required behavior

- The Focus column paints nothing: `background: transparent`, no radius, no padding on its header or
  its scrolling body. Cards sit directly on the board canvas.
- The inset moves up to `.eyes-on-agents__main` (8px), so the content still breathes while the column
  itself has none.
- The column keeps an 8px gap between its header and the scrolling list, matching the card rhythm, so
  the search row never touches the first card.
- Window-activation tinting is retired with the surface it colored: the `--eyes-column*` tokens, the
  `eyes-on-agents--inactive` modifier, and the renderer's `windowActive` flag plus its `blur`
  listener all go. The `focus` listener keeps driving the metadata refresh.
- Two palette tokens come from `theme.ts` and are declared on the renderer root:
  `--eyes-accent: #606b9d` (arcoblue-5) and `--eyes-hover-surface: #e2e4eb` (arcoblue-2).
- `Read all` uses `--eyes-accent` as its ink; on hover it gains `--eyes-hover-surface` behind it and
  deepens to `--eyes-primary-deep`. The card's overflow (`…`) text button gets the same treatment: a
  text button must show a hover surface, not only a color shift.
- The search input reads as a white field by default (`--eyes-item`), not a tinted one.
- Dropdown menu options center their icon against their label instead of letting Arco's inline layout
  drop the icon onto the text baseline.
- The menu bar keeps its existing white-alpha hover, because it sits on the Royal Blue bar where a
  light theme surface would be wrong.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/App.less`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.less`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn build`
- Static coverage asserts the transparent column, the absent paddings, the 8px region inset, the
  header/body gap, both theme tokens, the two hover surfaces, the white input, the centered options,
  and the absence of every activation-tint symbol.

## Result

Implemented as specified, in several quick passes as the owner refined it:

- first the column lost its surface and every padding, which turned out to strip the content inset
  entirely — corrected by giving `.eyes-on-agents__main` an 8px inset and the column an 8px
  header-to-body gap;
- `Read all` moved to `--eyes-accent` with a real hover surface, and the same hover treatment went to
  the card's `…` trigger;
- the search field became white by default;
- menu options became centered flex rows, because Arco lays option content out inline and left the
  13px icons sitting on the label baseline.

Consequence worth naming: this reverses task 061. The pale-orange window-activation tint had exactly
one surface — the column background — so removing that background removes the signal, and its
machinery (`windowActive`, the `blur` listener, `eyes-on-agents--inactive`, `--eyes-column*`) is gone
rather than left dead. If the activation signal is still wanted it needs a different host, for
example the menu bar.

Note for later: the drawer is anchored to `.eyes-on-agents__main`, which now has padding, so the
connections panel is inset by those 8px instead of sitting flush against the region edges.

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents:ui` (69 assertions),
`yarn build`. Electron E2E not run.
