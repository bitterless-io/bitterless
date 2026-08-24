---
id: todo-detail-overlay-reveal-015
scope: stop the Todo detail panel from squeezing the board and let locate scroll the open row out from under it
status: done
depends-on: [todo-domain-board-layout-005]
verify: node --test scripts/todo/todo-column-layout.test.mjs; yarn typecheck:todo-web
---

# Todo detail panel overlays instead of squeezing the board

## Problem

Opening a Todo detail reserves the panel width through board padding
(`.todo-app__board--detail-open .todo-app__board-scroll { padding-right: calc(320px + 12px); }`).
That narrows the wrapping width, so columns re-wrap and shrink the moment a Todo is selected, and the
board still hides horizontal overflow — the strip under the panel cannot be reached at all. The
detail panel's locate action only restores vertical visibility, so a row in a column sitting under
the panel stays invisible after locating.

## Objective

With the detail panel open, keep the left board content at the full window width — identical
wrapping to the closed state — let the panel overlay the right edge, and allow horizontal scrolling
so the occluded strip can be revealed. The detail panel's locate action must then bring the open
`TodoRow` into the actually visible board region on both axes.

## Implementation contract

- Remove the panel-width reservation: no `padding-right` on `.todo-app__board-scroll` when
  `--detail-open` is set, and delete the now-meaningless `@media (max-width: 680px)` override that
  only undid that reservation. Column wrapping is computed from the full board width in both states,
  so opening or closing the panel never re-flows the board.
- When `--detail-open` is set, the board scroll container allows horizontal overflow
  (`overflow-x: auto`) and the wrapping draggable gains exactly the panel width of trailing scroll
  slack (`margin-right: 320px`), keeping its own `width: 100%`. Scrolled fully right, the last
  column's right edge sits 12px clear of the panel's left edge; scrolled fully left, the board looks
  exactly as it does with the panel closed. Base state keeps `overflow-x: hidden`.
- `locateTodo` computes one `scrollTo` on `.todo-app__board-scroll` for both axes instead of
  `scrollIntoView`. The horizontal visible region ends `320px + 12px` before the container's right
  edge while the detail is open and at its right edge otherwise; the vertical region is the full
  container. Each axis keeps `nearest` semantics — no scrolling when the column already fits, and
  start alignment when the column is larger than the visible region.
- Keep the existing row centering inside `.domain-column__body` and the smooth behavior. Keep the
  panel a 320px absolute right overlay in `TodoDetail.less`; no new component, prop, or event.
- Panel width and gap live in one named place in the store instead of being repeated as literals in
  the locate math.
- Extend the Todo column layout regression to the new detail-open contract and the panel-aware
  locate math, replacing the assertions that pinned the reservation and the horizontal-scroll ban.

## Path

- `src/renderer/todo/src/App.less`
- `src/renderer/todo/src/store/todo.store.ts`
- `scripts/todo/todo-column-layout.test.mjs`
- `docs/features/todo-layout.md`
- this task

## Verification

- `node --test scripts/todo/todo-column-layout.test.mjs`;
- `yarn typecheck:todo-web`;
- `git diff --check`.
- Electron E2E not run (owner did not request it this session).

## Result

- Board wrapping no longer changes when a Todo is selected: the panel overlays the right 320px and
  the board keeps the full window width.
- With the panel open the board scrolls horizontally by exactly the panel width, so the occluded
  strip is reachable, and locate scrolls the open row's column out from under the panel while
  keeping it vertically visible and the row centered in its column body.

## Completion evidence

- `node --test scripts/todo/todo-column-layout.test.mjs` — pass, 9/9, including the rewritten
  detail-overlay and panel-aware-locate assertions.
- `yarn typecheck:todo-web` — pass.
- `git diff --check` — pass.
- Electron E2E not run.
