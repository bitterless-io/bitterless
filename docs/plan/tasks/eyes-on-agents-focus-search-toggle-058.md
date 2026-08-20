---
id: eyes-on-agents-focus-search-toggle-058
scope: make the Focus search a true toggle with a close control and retire the Project filter
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-search-affordance-057]
---

# EyesOnAgents Focus Search Toggle

## Objective

Turn the Focus title filter into a real toggle — `Cmd+F` / `Ctrl+F` opens it and closes it, and
closing always clears — replace the misleading `×` clear control with a close control, and remove the
Project filter from the UI.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents Project filter](../../features/eyes-on-agents-project-filter.md)
- [Focus search affordance](eyes-on-agents-focus-search-affordance-057.md)

Task 055 made the shortcut open-only, so a second press did nothing. The row's `×` cleared the query
but kept the row open, which reads as a close button. The owner also decided the Project filter is
not wanted on this board.

## Required behavior

- `Cmd+F` / `Ctrl+F` toggles: closed → open and focus the input; open → close. The `⌕` header button
  toggles identically.
- Closing always clears the query, whether it came from the shortcut, the `⌕` button, `Escape`, the
  close control, or unmount. No invisible filter can survive a close.
- The row's trailing control is a **close** control, not a clear control: it closes the row (clearing
  the query) and returns focus to the `⌕` toggle. Its accessible label says close.
- The Project filter is removed from the renderer: no Select in the Focus column, no
  `ProjectFilter` component, no `projectFilter.service.ts`, and no project selection state, options,
  or reconciliation in the store.
- Main-side Project metadata stays exactly as it is — resolution, the three `project_*` columns, and
  snapshot fields are untouched, like the retained Domain storage.
- The column empty state now has two cases only: an active title filter shows the title-search text,
  otherwise the Focus empty text.
- Prune the i18n keys whose UI is gone (`board.projectFilterLabel`, `board.allProjects`,
  `board.noProject`, `board.emptyProject`, `board.emptyNoProject`) and rename
  `actions.clearTitleSearch` to `actions.closeTitleSearch` in both locales.
- Delete the renderer-only Project filter tests and drop their package scripts; keep every Main-side
  project-resolver test.
- Remove the Focus attention tint: the single column uses the neutral column surface, and the
  `--eyes-column-focus` token goes with it.
- Carry the narrow-window reflow fix recorded in
  [the reflow issue](../../issues/eyes-on-agents-narrow-window-no-reflow.md): the renderer root drops
  its 800px/600px floors so the board re-lays out inside a smaller window, and the stale
  `cursor: grab` on non-draggable cards becomes the default cursor.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/features/eyes-on-agents-project-filter.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `package.json`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/ProjectFilter/` (deleted)
- `src/renderer/eyesOnAgents/src/services/projectFilter.service.ts` (deleted)
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/project-filter.test.mjs` (deleted)
- `scripts/eyes-on-agents/project-filter-render.test.mjs` (deleted)
- `scripts/eyes-on-agents/focus-board-store.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `scripts/eyes-on-agents/activation-refresh.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents`
- `yarn check:renderer-i18n`
- `yarn build`
- Store coverage asserts the toggle/close clearing contract and that no project selection state
  remains; static coverage asserts the close control, the toggle wiring from `Cmd+F`, and the absent
  Project filter.

## Result

Implemented, and one extra owner request landed in the same pass: the Focus attention tint is gone.

- `Cmd+F` / `Ctrl+F` and the `⌕` button both call one `toggleTitleSearch`, which closes an open row
  and opens a closed one; `App.vue` → `AgentBoard` → `DomainColumn` all expose `toggleTitleSearch`
  instead of `openTitleSearch`.
- The trailing control is now `eyesOnAgents__domainColumn__closeTitleSearch` with the
  `actions.closeTitleSearch` label and the `.agent-domain__search-close` class; every close route
  (shortcut, toggle, `×`, `Escape`, unmount) clears the query and returns focus to the toggle. The
  old clear-and-stay handler is gone.
- The Project filter is fully retired from the renderer: `components/ProjectFilter/`,
  `services/projectFilter.service.ts`, `projectFilter`/`projectOptions`/`projectFilterValue`/
  `isProjectFiltered`/`selectProjectFilter`/`reconcileProjectFilter`, the five `board.*` project
  strings, and both renderer-only Project filter test files with their package scripts. Main-side
  resolution and the `project_*` columns are untouched.
- The column empty state has two cases now (title filter, otherwise Focus text).
- Focus tint removed: `.agent-domain--focus` and the `--eyes-column-focus` token are deleted, so the
  column uses the neutral column surface and hierarchy is canvas → column → white cards.

The store contract test replaced its Project-composition case with one that asserts every project
member is `undefined` and that a Project name never satisfies the title filter; `ui-source` gained
toggle/close, tint-absence, and no-Project-surface assertions.

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents` (whole suite),
`yarn check:renderer-i18n`, `yarn build`. E2E not run.
