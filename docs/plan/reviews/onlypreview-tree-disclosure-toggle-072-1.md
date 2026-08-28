---
id: onlypreview-tree-disclosure-toggle-072-1
status: passed
reviewed_task: onlypreview-tree-disclosure-toggle-072
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-contract-and-ui-review
---

# onlypreview-tree-disclosure-toggle-072 — Review 1

- Result: **PASS**
- Scope: one-click directory-arrow disclosure, exact rapid-double-click fencing, preserved row-body
  selection/double-click behavior, tree ARIA and keyboard ownership, layout neutrality, focused
  tests, and task-scoped performance/resource risk.
- Unrelated dirty-worktree changes were preserved and excluded. This review changed only this
  review document.
- Electron, Playwright, E2E, packaged smoke, the real application, and live pointer automation were
  not run, as required.

## Findings

No P1, P2, or P3 finding exists. No blocking finding exists.

The focused UI tests are production-source contract checks rather than mocks: they read the actual
SFC, Less, and Store files, fence the exact row and chevron regions, and cross-check event modifiers,
ARIA ownership, the click-detail guard, the Store activation path, and hit-target dimensions. They
do not independently simulate native pointer focus, so Ral's documented live pointer verification
remains the final acceptance step; this is not a delivery finding because task 072 explicitly calls
for source/UI assertions and reserves live pointer verification for the owner.

## 文件清单

| #   | 文件                                                                   | 问题数 |
| --- | ---------------------------------------------------------------------- | ------ |
| 1   | `docs/plan/tasks/onlypreview-tree-disclosure-toggle-072.md`            | 0      |
| 2   | `docs/issues/onlypreview-directory-selection-and-global-file-scope.md` | 0      |
| 3   | `docs/design/onlypreview-global-search.md`                             | 0      |
| 4   | `docs/features/onlypreview.md`                                         | 0      |
| 5   | `docs/plan/README.md`                                                  | 0      |
| 6   | `docs/INDEX.md`                                                        | 0      |
| 7   | `src/renderer/onlypreview/shell/src/App.vue`                           | 0      |
| 8   | `src/renderer/onlypreview/shell/src/App.less`                          | 0      |
| 9   | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`         | 0      |
| 10  | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`                  | 0      |
| 11  | `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`              | 0      |

## 问题清单

No TS-1, TS-2, FE-1, or FE-2 issue exists in the task-scoped changes.

- The reviewed Vue, Less, Store, and focused test files are 544, 566, 798, 98, and 541 lines;
  every TS/JS/Vue file remains within the 800-line limit.
- Task 072 introduces no `function` declaration/expression.
- The SFC contains only declarative event routing. Selection, Current-directory reporting,
  expansion mutation, and lazy directory loading remain in `onlyPreviewShell.store.ts`; no business
  flow moved into the SFC and no business `emit` was introduced.

## Contract evidence

### Arrow click selects and toggles exactly once

- `App.vue:189-202` places the chevron inside the existing directory row as a named
  `span`, not a nested button. Its first click calls the Store with the actual click detail and
  `toggleDirectory = true`, while `.stop` prevents the row click handler from receiving the same
  gesture.
- `onlyPreviewShell.store.ts:289-292` rejects every click with `detail > 1`. The first ordinary
  click (`detail === 1`) and programmatic click (`detail === 0`) each make exactly one
  `activateEntry(..., true, true)` call.
- `onlyPreviewShell.store.ts:660-671` first sets focused and selected relative paths, reports the
  updated Global Search context, and then invokes `toggleDirectory()` exactly once for a directory.
  The same path applies to the synthetic root because the template gates only on
  `nodeKind === 'directory'`, not on a non-empty relative path.
- The SFC compiler resolves the empty `@dblclick.prevent.stop` binding to one
  `withModifiers(() => {}, ['prevent', 'stop'])` handler. In the native double-click sequence, the
  first click toggles, the second click is rejected by its `detail === 2`, and the resulting
  `dblclick` cannot bubble to the row handler.

### Row body, ARIA, and keyboard remain unchanged

- `App.vue:158-188` keeps one focusable `button` per tree item with `role="treeitem"`, roving
  `tabindex`, `aria-level`, `aria-expanded`, and `aria-selected`. The arrow span is `aria-hidden`,
  has no role or tabindex, and therefore introduces no second tree item or Tab stop.
- The outer row still routes ordinary clicks through `handleTreeClick(entry, detail)` with the
  default `toggleDirectory = false`: one click selects without changing directory expansion.
  Its existing `@dblclick.prevent` still calls `handleTreeDoubleClick()`, which reaches one
  `activateEntry(entry, true, true)` call after the second row click has been ignored.
- `App.vue:450-468` preserves the existing `Space`/`Enter` activation and
  `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Home`/`End` roving-focus path. Arrow pointer
  behavior adds no keyboard branch and does not alter file preview, context-menu, or copy handlers.

### Layout and performance remain bounded

- `App.less:314-339` keeps the artwork at 13px and adds a 17×21px pointer target. Its 17px flex
  basis plus two `-2px` horizontal margins consumes the same net 13px row width as the old chevron,
  while 21px stays inside the existing 27px row. The following 4px row gap, indentation, folder
  icon, and name alignment therefore do not shift.
- The hover uses the existing `--onlypreview-royal-soft` token. The icon itself has
  `pointer-events: none`, so nested SVG paths cannot change the event boundary, and the existing
  reduced-motion rule still disables its rotation transition when requested.
- The implementation adds two inert DOM listeners per rendered directory and constant-time Set
  selection/expansion work only on pointer activation. It adds no observer, timer, animation loop,
  renderer/process, filesystem traversal, index/search request, or project-size-dependent copy.
  Expanding a directory reuses the pre-existing demand-loaded `loadDirectory()` path.

## Test evidence

- `onlyPreviewSearchShellUi.test.mjs:33-70` fences the actual row markup, proves the named span and
  both stopped gesture bindings, rejects nested button/role/tabindex markup, retains row handlers
  and ARIA, and checks the exact hit-target and existing color token.
- `onlyPreviewSourceIntegration.test.mjs:405-461` independently retains the tree keyboard keys,
  verifies row and arrow handler separation, checks the click-detail fence and single activation
  chain, and follows selection through the Current-directory context contract.
- `onlyPreviewSearchShell.test.mjs` executes the real pure tree implementation for the synthetic
  root and Arrow-key behavior; `onlyPreviewProjectRoot.test.mjs` executes the real root capability
  and root-directory contract. No fake pointer/store implementation was substituted.

## Verification

| Check                                                                                                                                                                                                                         | Result                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `node --test tests/onlypreview/onlyPreviewSearchShellUi.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewProjectRoot.test.mjs` | **PASS — 17/17**                                                                              |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`                                                                                                                                                      | **PASS**                                                                                      |
| Direct `@vue/compiler-sfc` template compilation                                                                                                                                                                               | **PASS — no compiler error; click/double-click modifiers compile to the intended boundaries** |
| Focused ESLint over `App.vue`, Store, and the two changed tests                                                                                                                                                               | **PASS — 0 errors**                                                                           |
| Task-path `git diff --check`                                                                                                                                                                                                  | **PASS**                                                                                      |
| Code-review TS-1/TS-2/FE-1/FE-2 audit                                                                                                                                                                                         | **PASS — 0 findings**                                                                         |
| Build / Electron / Playwright / E2E / packaged smoke / real app                                                                                                                                                               | Not run in this independent review                                                            |

The whole-file Prettier check reports shared-worktree formatting drift outside task 072's hunks:
the pre-existing uppercase excluded-folder color in `App.less`, unrelated compact Store blocks,
and unrelated Global Search assertions in the two shared test files. The task-072 markup, hit-target
style block, Store handler, and newly added assertions match Prettier output, while the task-path
`git diff --check` is clean. This baseline noise is not a task-072 delivery finding.

## Conclusion

**PASS.** A single arrow click selects/focuses the directory, updates Current directory, and toggles
expansion once. A rapid second click and its `dblclick` are both contained at the arrow, while the
rest of the row preserves one-click selection and one double-click toggle. The existing row remains
the sole ARIA/keyboard tree item, the 17×21px hit target is layout-neutral, and the change introduces
no meaningful performance or device-stability risk. Task 072 is ready for the parent full build and
Ral's live pointer acceptance.
