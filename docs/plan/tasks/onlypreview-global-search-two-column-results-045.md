---
id: onlypreview-global-search-two-column-results-045
scope: Side-by-side Contents and Files result columns above the existing full-width Global Search Preview
status: implemented; owner verification pending
depends-on: [onlypreview-global-search-dismiss-scrim-044]
verify: focused Global Search Node tests, directed vue-tsc, task-scoped ESLint, yarn build, git diff --check; no Electron/Playwright/E2E
---

# Arrange Global Search results as two columns

## Objective

Match the accepted Global Search sketch: keep the query and Contents scope controls full-width at
the top, place Contents on the left and Files on the right in equal independently scrolling
columns, and keep the resizable Preview full-width below both columns.

## Context

- `docs/design/onlypreview-global-search.md`
- `docs/plan/tasks/onlypreview-global-search-workspace-037.md`
- `docs/plan/tasks/onlypreview-global-search-dismiss-scrim-044.md`

## Path

- `src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue`
- `src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less`
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`
- `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`
- `docs/design/onlypreview-global-search.md`
- `docs/plan/README.md`

## Contract

- The header remains one full-width region containing the search input and Contents scope row.
- The upper result region is a fixed two-column grid: Contents left, Files right, equal width. Do
  not add tabs, cards, a horizontal carousel, another process/view, or a user-configurable width.
- Each column owns its vertical scrolling and sticky group header. Collapsing one section leaves
  the other section and its scroll position independent.
- The no-workspace state spans both columns. Pending and error feedback remain one shared status
  row spanning both columns without becoming part of either result scroller.
- DOM order and linear Arrow Up/Down selection follow the visible reading order: Contents first,
  then Files. Each section retains its existing internal result order, caps, tokens, selection,
  double-click/open behavior, and preview loading.
- One quiet divider separates the columns. Reuse the existing Canvas/Surface/Royal/Ink visual
  system; no new palette, shadow, blur, animation, transition, or decorative container.
- The existing horizontal Preview separator continues to span the complete search width and keeps
  its 25–70% keyboard/pointer resize contract. Preview remains one full-width bottom region.
- At constrained widths, keep both columns visible with `minmax(0, 1fr)` and existing text
  ellipsis. Do not stack or introduce horizontal page scrolling.
- Search execution, section concurrency, XPC contracts, SQLite/indexing, Main native-view bounds,
  dismissal scrim, and Preview adapters remain unchanged.

## Layout

```text
┌────────────────────────────────────────────────────┐
│ Search input                                       │
│ Contents scope                                    │
├─────────────────────────┬──────────────────────────┤
│ CONTENTS                │ FILES                    │
│ independent scroll      │ independent scroll       │
│ matched context rows    │ folders, then files      │
├─────────────────────────┴──────────────────────────┤
│ horizontal Preview resize separator                │
├────────────────────────────────────────────────────┤
│ PREVIEW — selected result, full width              │
└────────────────────────────────────────────────────┘
```

## Verification

- Source/UI tests prove the exact Contents-left/Files-right DOM structure, equal two-column grid,
  independent overflow containers, shared state row, vertical divider, and unchanged full-width
  Preview separator.
- Store tests prove linear result selection follows Contents then Files while collapse still removes
  only the chosen section.
- Run focused non-Electron tests, directed Renderer typecheck, task-scoped ESLint, `yarn build`, and
  `git diff --check`. Do not run Electron, Playwright, E2E, packaged smoke, or the real app.

## Delivery

- The results region now contains two equal bounded panes: Contents on the left and Files on the
  right. Each pane owns its sticky header, rows, empty state, collapse state, and vertical scroll.
- The no-workspace state and request status span both columns. The existing single horizontal
  separator and single lazy Preview remain outside the results grid and full-width.
- Linear selection now follows Contents then Files, matching DOM and visual reading order without
  changing section-internal ordering, result caps, search execution, XPC, indexing, or Preview
  adapters.

## Verification Results

- Focused Global Search Node tests: **PASS, 25/25**.
- `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`: **PASS**.
- Task-scoped production ESLint: **PASS**.
- `yarn build`: **PASS**; validation-only package-name mutation restored afterward.
- `git diff --check`: **PASS**.
- [Independent review 1](../reviews/onlypreview-global-search-two-column-results-045-1.md):
  **PASS**, no P1, P2, or P3 finding.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Owner Verification

- Search a term with both filename and content matches. Confirm Contents appears left, Files right,
  both columns scroll independently, and selecting either side updates the full-width Preview.
- Resize Preview with pointer and keyboard, then narrow the window to its supported minimum. Confirm
  both result columns remain visible without page-level horizontal scrolling.
