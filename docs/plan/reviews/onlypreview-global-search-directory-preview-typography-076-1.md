---
id: onlypreview-global-search-directory-preview-typography-076-1
status: passed
reviewed_task: onlypreview-global-search-directory-preview-typography-076
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-contract-and-ui-review
---

# onlypreview-global-search-directory-preview-typography-076 — Review 1

- Result: **PASS**
- Scope: bottom Global Search directory Preview typography, inherited Search-renderer baseline,
  row/icon/layout stability, direct-child data and interaction neutrality, selector isolation, and
  Project-tree/result-row non-regression.
- Unrelated dirty-worktree changes were preserved and excluded. This review changed only this
  review document.
- Electron, Playwright, E2E, packaged smoke, the real application, and live visual automation were
  not run, as required.

## Findings

No P1, P2, or P3 finding exists. No blocking finding exists.

## 文件清单

| #   | 文件                                                                                           | 问题数 |
| --- | ---------------------------------------------------------------------------------------------- | ------ |
| 1   | `docs/plan/tasks/onlypreview-global-search-directory-preview-typography-076.md`                | 0      |
| 2   | `docs/design/onlypreview-global-search.md`                                                     | 0      |
| 3   | `docs/features/onlypreview.md`                                                                 | 0      |
| 4   | `src/renderer/onlypreview/globalSearch/src/App.less`                                           | 0      |
| 5   | `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.less`   | 0      |
| 6   | `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/DirectorySearchPreview.vue` | 0      |
| 7   | `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`                                         | 0      |

## Contract evidence

### The requested typography is exact and is one pixel above the inherited baseline

- `GlobalSearchPreview.less:59-69` applies `font-size: 13px` and `font-weight: 600` directly to
  `.onlypreview-search-preview__directory-entry`, matching the task's semibold contract exactly.
- `globalSearch/src/App.less:46-50` establishes `font-size: 12px` on the independent Search
  renderer's `#app`. `GlobalSearchWorkspace` is mounted beneath that node and lazy-loads
  `GlobalSearchPreview`, so the former directory-entry value really was the inherited 12px base;
  the override is exactly `+1px`.
- The canonical design and feature documents describe the same 13px/600 result and do not broaden
  it to the Project tree or Files/Contents result rows.

### Geometry, icons, data, ordering, and interactions remain unchanged

- The same selector retains `height: 28px`, `gap: 7px`, and `padding: 0 8px`; its divider, color,
  flex alignment, and surrounding directory Preview padding are unchanged. Compiling the Less
  produces one valid block with those existing declarations followed only by the two typography
  declarations.
- `DirectorySearchPreview.vue:4-11` remains unchanged. It still iterates `preview.entries` in the
  supplied order, keys by `relativePath`, renders `entry.name`, and uses 14px `IconFolder` /
  `IconFile` components. It contains no click, double-click, keyboard, focus, selection, or open
  handler.
- The existing hidden-preload directory Preview continues to bound, directory-first/naturally
  order, and return the direct-child collection. Task 076 changes neither that implementation nor
  its 200-entry cap, containment checks, data shape, or selection/open flow.

### The selector cannot leak into Project or result lists

- Production search finds the entry class only on the directory Preview row and its exact Less
  selector (plus its SVG descendant color selector). Project-tree rows and Files/Contents result
  rows use separate `onlypreview-shell__tree-*` and `onlypreview-global-search__result-*` classes.
- `GlobalSearchPreview.less` is imported by `GlobalSearchPreview.vue`; although the style block is
  intentionally unscoped, the full BEM class is unique. No element in `App.vue`,
  `GlobalSearchWorkspace.vue`, or `SearchResultRow.vue` carries it.
- `DirectorySearchPreview.vue` and `SearchResultRow.vue` have no task-076 working-tree diff. The
  shared worktree contains earlier task changes in the Project tree and native Search layout, but
  this typography hunk neither selects nor modifies those surfaces.

## Performance and device-stability evidence

- The implementation adds two static CSS declarations to at most the already bounded 200 rendered
  direct-child rows. It adds no DOM node, reactive state, listener, traversal, sort, timer,
  observer, renderer/process, filesystem I/O, allocation, or dependency.
- Fixed 28px row geometry remains in force. A one-pixel glyph-size increase can affect only paint
  metrics inside the existing flex-centered row and cannot grow the list or trigger application
  work proportional to the project size.

## Verification

| Check                                                                                                                                  | Result                             |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `node --test tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`                                                                     | **PASS — 13/13**                   |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`                                                               | **PASS**                           |
| Direct Less compilation of `GlobalSearchPreview.less` and exact selector inspection                                                    | **PASS**                           |
| One-off source assertions for 12px baseline, 28px height, 14px icons, padding, data binding, no entry handlers, and selector isolation | **PASS**                           |
| Focused ESLint for the changed test with unrelated shared-file explicit-return/Prettier rules disabled                                 | **PASS — 0 remaining errors**      |
| Prettier check for the changed Less and task document, plus repository-config formatting of the exact new test block                   | **PASS**                           |
| Task-path `git diff --check`                                                                                                           | **PASS**                           |
| Build / Electron / Playwright / E2E / packaged smoke / real app                                                                        | Not run in this independent review |

The ordinary whole-file ESLint/Prettier invocation still reports one explicit-return error and
seven formatting warnings in unrelated pre-existing sections of the shared
`onlyPreviewGlobalSearchUi.test.mjs`. The task-076 test block at lines 44-53 has no lint error and
matches the repository Prettier configuration exactly; the changed Less and task document also
pass Prettier. This shared-file baseline noise is not a task-076 delivery finding.

## Remaining owner verification

- Ral should select a directory result and visually confirm both folder and file child names in the
  bottom Preview are one pixel larger and semibold.
- Confirm the row remains 28px tall, the icons remain 14px, long-name behavior and ordering are
  unchanged, and the Project tree plus the upper Contents/Files rows retain their prior typography.

## Conclusion

**PASS.** Bottom directory Preview child names now render at exactly 13px/600 over the verified
12px Search-renderer baseline. The dedicated selector is unique to that surface, while 28px row
height, 14px icons, spacing, direct-child ordering/data, interactions, Project-tree rows, and
Contents/Files result rows remain unchanged. The two static CSS declarations introduce no
meaningful performance or device-stability risk. Task 076 is ready for parent completion checks and
Ral's live visual acceptance.
