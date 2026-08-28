---
id: onlypreview-global-search-floating-surface-048-1
status: passed
reviewed_task: onlypreview-global-search-floating-surface-048
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-contract-and-ui-review
---

# onlypreview-global-search-floating-surface-048 — Review 1

- Result: **PASS**
- Scope: Search-only native transparency, transparent renderer canvas, exact body-level 24px
  gutter, one clipped 14px workspace with a two-layer Ink shadow, gutter-only opener dismissal,
  preserved Preview bounds/z-order, and process/view/lifecycle regressions.
- Unrelated dirty-worktree changes were preserved and excluded. This review changed only this
  review document.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Findings

### P3 — non-blocking — the focused Shell test file exceeds the 800-line repository limit

- Rule: `TS-1`.
- Location: `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs:1-880`.
- Evidence: the file is 880 lines. Task 048's opener-dismiss regression is correctly bounded at
  `:860-879`, but extending this already-large suite leaves it above the repository-wide 800-line
  ceiling.
- Impact: maintainability only; it does not weaken the floating-surface contract or runtime
  behavior and therefore does not block delivery.
- Recommendation: split Global Search interaction/lifecycle tests into a sibling focused test file
  before the next feature adds cases to this suite.

No P1 or P2 finding exists. No blocking finding exists.

## 文件清单

| #   | 文件                                                                                    | 问题数 |
| --- | --------------------------------------------------------------------------------------- | ------ |
| 1   | `docs/plan/tasks/onlypreview-global-search-floating-surface-048.md`                     | 0      |
| 2   | `docs/design/onlypreview-global-search.md`                                              | 0      |
| 3   | `docs/INDEX.md`                                                                         | 0      |
| 4   | `docs/plan/README.md`                                                                   | 0      |
| 5   | `src/main/windows/onlyPreviewWindow.helper.ts`                                          | 0      |
| 6   | `src/renderer/onlypreview/globalSearch/src/App.less`                                    | 0      |
| 7   | `src/renderer/onlypreview/globalSearch/src/App.vue`                                     | 0      |
| 8   | `src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less` | 0      |
| 9   | `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`                   | 0      |
| 10  | `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`                                  | 0      |
| 11  | `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`                               | 1      |

No task-scoped TS-2, FE-1, or FE-2 issue exists. The new Vue handler is a bounded local pointer
interaction, not business orchestration, and it emits no event to a parent component.

## Contract evidence

### Search-only native and HTML transparency

- `onlyPreviewWindow.helper.ts:711-738` still creates the existing Shell, Preview, or Global Search
  `WebContentsView` through one factory. The sole `setBackgroundColor` call is guarded by
  `mode === 'globalSearch'` at `:730`; Shell and Vue/Chrome Preview background and bounds paths are
  untouched.
- `globalSearch/src/App.less:13-31` makes `html`, `body`, and `#app` transparent, keeps page overflow
  bounded, and assigns exactly `padding: 24px` to `body`. The shared `border-box` rule at `:34-38`
  makes that inset part of the viewport-sized body rather than expanding it.
- `globalSearch/src/App.less:46-55` keeps `#app` overflow visible and fills its content box, so the
  workspace shadow can paint into the 24px gutter instead of being clipped at the app boundary.

### One rounded, clipped, shadowed workspace

- `GlobalSearchWorkspace.less:1-12` keeps the existing Canvas surface and grid sizing, adds one
  `14px` outer radius with `overflow: hidden`, and declares exactly two comma-separated Ink-colored
  `box-shadow` layers. The block contains no `filter` or `backdrop-filter`.
- The radius/overflow pair clips Header, Contents/Files, split, and Preview to the same outer shape.
  An element's own outer shadow is not clipped by its descendant overflow boundary; the visible
  24px body gutter provides bounded room for both shadow layers.
- No shadow was added to result rows, columns, Preview internals, or the Shell dismissal shield.
  No gradient, blur, backdrop filter, animation, component library, or decorative layer was added.

### Gutter-only opener dismissal

- `globalSearch/src/App.vue:10-18` accepts only a click whose exact target is `document.body`.
  A click on the workspace root or any descendant retains that descendant as its event target and
  returns before dismissal, so internal search interaction remains live.
- The accepted gutter event is consumed with `preventDefault()` and
  `stopImmediatePropagation()` before calling the existing Store dismissal. The listener is added
  once on mount and removed with the same callback on unmount.
- `onlyPreviewGlobalSearch.store.ts:210-213` routes `dismiss()` through the configured
  `closeSearch('opener')` capability. `globalSearch/src/main.ts:8-12` binds that capability to the
  existing native host client; no duplicate close protocol was introduced.
- `onlyPreviewGlobalSearchShell.test.mjs:860-879` proves direct gutter dismissal and empty-query
  Escape share the exact `opener` close mode. `onlyPreviewGlobalSearchUi.test.mjs:237-286` proves
  the body-target gate, event consumption, matching mount/unmount lifecycle, and floating-surface
  source contract.

### Bounds, z-order, warm lifecycle, and resource model

- Task 048 changes no bounds calculation or child-view attachment. The existing Global Search
  service keeps one lazily-created view, reuses it while live, attaches it at the current Preview
  bounds as the topmost child, and detaches rather than destroys it on close
  (`onlyPreviewGlobalSearchView.service.ts:226-270`).
- The implementation adds one CSS paint and one renderer-local click listener only. It adds no
  renderer entry, process, native view, worker, timer, observer, filesystem operation, search
  request, or project-size-dependent allocation. Query/scope state and result/Preview layout remain
  unchanged.

## Verification

| Check                                                                                                                               | Result                                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `node --test tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`          | **PASS — 26/26**                               |
| `yarn eslint src/renderer/onlypreview/globalSearch/src/App.vue src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts` | **PASS**                                       |
| Task-scoped App/Less/task-doc Prettier check                                                                                        | **PASS**                                       |
| Task-path `git diff --check`                                                                                                        | **PASS**                                       |
| Code-review TS-1/TS-2/FE-1/FE-2 audit                                                                                               | **PASS with one P3 non-blocking TS-1 finding** |
| Build / Electron / Playwright / E2E / packaged smoke / real app                                                                     | Not run in this independent review             |

Whole-file Prettier still reports the design document's inherited broad Markdown table/type-block
formatting drift; the task's production styles, Vue file, and task document pass their focused
check, and `git diff --check` is clean. This baseline formatting noise is not a task-048 delivery
finding.

## Conclusion

**PASS.** The native Search view and its HTML canvas are transparent, the body owns the exact 24px
gutter, and the complete opaque workspace is one clipped 14px surface with a restrained two-layer
Ink shadow. Only the transparent body gutter invokes the consumed opener-dismiss path, internal
clicks remain interactive, and the existing Preview bounds, topmost native ordering, warm renderer,
query/scope behavior, and process/view count are unchanged. The single P3 test-file size finding is
non-blocking.
