---
id: onlypreview-global-search-two-column-results-045-1
status: passed
reviewed_task: onlypreview-global-search-two-column-results-045
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-contract-and-ui-review
---

# onlypreview-global-search-two-column-results-045 — Review 1

- Result: **PASS**
- Scope: accepted Contents-left/Files-right layout, independent result scrolling, shared state row,
  full-width Preview/splitter, linear keyboard order, constrained-width behavior, task-scoped code
  rules, performance, and regression boundaries.
- Unrelated dirty-worktree changes were preserved and excluded. No production or test source was
  modified by this review.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Findings

No P1, P2, or P3 finding remains.

During review, the Interaction table still said `Files then Contents`; the implementation agent
corrected that one stale sentence. The current design, task, DOM, store, and tests now all specify
`Contents then Files`.

## 文件清单

| #   | 文件                                                                                    | 问题数 |
| --- | --------------------------------------------------------------------------------------- | ------ |
| 1   | `docs/plan/tasks/onlypreview-global-search-two-column-results-045.md`                   | 0      |
| 2   | `docs/design/onlypreview-global-search.md`                                              | 0      |
| 3   | `src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue`  | 0      |
| 4   | `src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less` | 0      |
| 5   | `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`                   | 0      |
| 6   | `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`                                  | 0      |
| 7   | `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`                               | 0      |
| 8   | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`                                   | 0      |

## 问题清单

No TS-1, TS-2, FE-1, or FE-2 issue exists in the task-scoped changes.

- The reviewed Vue, Less, store, and test files are 296, 351, 588, 329, 657, and 59 lines,
  respectively; every TS/JS/Vue file remains below the 800-line limit.
- The task adds no `function` declaration/expression.
- The SFC change is declarative layout/binding only. Search state, selection ordering, and request
  behavior remain in `onlyPreviewGlobalSearch.store.ts`; no new business flow moved into the SFC.
- No task-scoped business `emit` was introduced.

## Contract evidence

### Two equal independently scrolling result ledgers

- `GlobalSearchWorkspace.vue:59-112` renders Contents first and Files second as sibling panes. Each
  pane owns only its section header, rows, and section-specific empty state.
- `GlobalSearchWorkspace.less:109-128` uses exactly
  `minmax(0, 1fr) minmax(0, 1fr)`, keeps the outer results grid overflow-hidden, gives each pane
  `min-width: 0`, `min-height: 0`, and its own `overflow: auto`, and places one Divider-token border
  on the right-hand Files pane.
- Both panes remain mounted when one section collapses, so collapsing one cannot destroy or replace
  the other pane or its scroll container. The existing sticky group header remains local to each
  pane.

### Shared state, splitter, and Preview

- `GlobalSearchWorkspace.vue:114-129` keeps pending/error feedback as one sibling after both panes,
  rather than duplicating it inside either scroller. `GlobalSearchWorkspace.less:267-284` spans the
  status and no-workspace state across both grid columns.
- `GlobalSearchWorkspace.vue:133-162` contains one horizontal separator followed by one Preview
  region outside the result grid. The root grid still assigns one full-width row to the separator
  and one to `--onlypreview-search-preview-height`; the 25–70% pointer/keyboard contract is
  unchanged.

### Visible and keyboard order

- `onlyPreviewGlobalSearch.store.ts:102-106` now exposes Contents rows before Files rows. Existing
  linear `moveSelection()` therefore follows the same left-to-right reading order as the DOM.
- The focused store regression proves initial selection, Arrow movement, and independent collapse
  against one result from each section. Folder-first ordering within Files and all result tokens,
  caps, opening, and preview fetching are untouched.
- `docs/design/onlypreview-global-search.md:65-82,220-235` and the accepted task contract describe the
  same Contents-left/Files-right layout and Contents-then-Files linear key order.

### Width, performance, and process boundaries

- Both columns retain `minmax(0, 1fr)` and the existing result-body/title/path/snippet shrink and
  ellipsis rules. The result grid cannot expand the native Search view or create page-level
  horizontal overflow, and no narrow-width stacking rule was introduced.
- The change adds two lightweight section wrappers and a second bounded scroll container around the
  same maximum 500 rows. It creates no list copy beyond the existing bounded `visibleResults`, no
  animation/filter/periodic work, and no extra renderer, native view, worker, XPC request, SQLite
  connection, traversal, or file read.
- No Main, preload, XPC, indexing, search-execution, native-view, dismissal-scrim, or Preview-adapter
  file is changed by task 045.

## Verification

| Check                                                                                           | Result                |
| ----------------------------------------------------------------------------------------------- | --------------------- |
| Three focused Global Search Node suites                                                         | **PASS — 25/25**      |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`                        | **PASS**              |
| Task-scoped production ESLint (`GlobalSearchWorkspace.vue`, `onlyPreviewGlobalSearch.store.ts`) | **PASS**              |
| Code-review TS-1/TS-2/FE-1/FE-2 audit                                                           | **PASS — 0 findings** |
| `yarn build`                                                                                    | **PASS**              |
| Task-scoped `git diff --check`                                                                  | **PASS**              |
| Electron / Playwright / E2E / packaged smoke / real app                                         | Not run, as required  |

Running ESLint against the three complete historical test files still reports four existing
`explicit-function-return-type` errors at
`onlyPreviewGlobalSearchShell.test.mjs:138,146,163` and
`onlyPreviewGlobalSearchUi.test.mjs:183`. Those functions predate and lie outside the 045 hunks; the
new 045 tests add no ESLint error. They are recorded as baseline noise, not a task-045 finding.

## Conclusion

**PASS — task 045 is ready for Ral's live acceptance.** Contents is the left and first logical
section, Files is the right and second section, each result ledger scrolls independently, shared
feedback and the single resizable Preview remain full-width, narrow layouts stay bounded, and the
change does not widen the search/runtime/process resource model.
