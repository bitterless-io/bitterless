---
id: onlypreview-multi-select-delete-121
scope: Project tree multi-selection, selection-wide copy, and permanent delete widened to folders through the alert-layer confirmation
status: implemented; owner verification pending
depends-on: [onlypreview-alert-dialogs-120, onlypreview-permanent-delete-029]
verify: node --test tests/onlypreview/*.test.mjs && yarn build
---

# OnlyPreview multi-select, copy and delete

## Objective

Owner request, 2026-09-03: 「目录文件要支持多选 和多选的复制，另外要支持目录和文件的删除，删除也必须弹窗
alert 确认后删除，也可以取消，右击菜单要有删除，删除是直接删除不是进垃圾桶」, with the collapse rule
「删除 a1/b1/c1 和 a1/b1 以及 a2/ 时，实际要处理过滤然后只删除 a1/b1 和 a2」.

Contract: [onlypreview-multi-select-delete](../../features/onlypreview-multi-select-delete.md).

## Path

- `src/shared/onlypreview/onlyPreviewDeleteSelection.shared.ts` — the collapse authority
- `src/shared/onlypreview/onlyPreview.types.ts` — `showFileContextMenu` carries the selection
- `src/preload/fileSearch/fileSearchProjectAuthority.service.ts` — directory delete
- `src/main/onlypreview/onlyPreviewDeleteDialog.service.ts`
- `src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts`
- `src/main/onlypreview/onlyPreviewClipboard.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.{service,store}.ts`
- `src/renderer/onlypreview/shell/src/{App.vue,App.less,onlyPreviewShell.store.ts}`
- `src/renderer/common/i18n/{en,zh}.ts`
- `tests/onlypreview/onlyPreviewDeleteSelection.test.mjs`,
  `tests/onlypreview/onlyPreviewDeleteDialog.test.mjs`,
  `tests/onlypreview/onlyPreviewTreeSelection.test.mjs`,
  `tests/onlypreview/onlyPreviewClipboard.test.mjs`,
  `tests/onlypreview/fixtures/{alertWindow,deleteI18n}.stub.mjs`

## Contract

1. The tree carries an ordered selection plus an anchor. Only a plain click and a plain arrow key
   move the anchor and re-point the preview; ⌘/Ctrl-click, ⇧-click, ⇧-arrow and ⌘/Ctrl+A never do.
2. A range walks the flattened **visible** rows. A collapsed folder's hidden children are not in a
   range; selecting the folder still removes its whole subtree, because the folder is the entry.
3. The workspace root never joins a multi-selection, and a selection whose rows disappear drops them.
4. The right-clicked row decides the target: inside the selection the action covers all of it,
   outside it the action covers that row alone. Delete reads `Delete N Items…` when more than one row
   is targeted.
5. The selection travels with the context-menu request and is re-validated in Main. Every entry is
   re-authorized per entry before any syscall — this payload only decides what the menu offers.
6. `collapseOnlyPreviewDeleteSelection` drops every entry covered by another selected **directory**,
   testing containment per path segment. The root is refused rather than collapsed.
7. One alert-layer confirmation covers the whole plan, listing what will actually be removed. The
   native `dialog.showMessageBox` delete confirmation is gone.
8. Entries are removed one at a time through the existing two-phase grant. A failure stops the run
   and reports how many were removed and which entry failed; a partial delete is never reported as a
   success.
9. A directory is removed by isolate-then-`rm -r`: pinned by `dev`/`ino` (a directory cannot hold a
   descriptor on Windows), renamed into the private recovery directory, re-checked, then removed.
   `rm` unlinks symbolic links instead of following them.
10. A directory's identity is `dev` + `ino` only. Its `size` and `mtime` change whenever a child
    changes, so comparing them would fail the confirmation for an ordinary background write.
11. A previewed file inside a removed folder clears the preview, not only an exact path match.
12. Every copy action covers the selection: one pasteable list for `item`, one line per entry in tree
    order for the three text kinds, bounded by `ONLY_PREVIEW_MAX_CLIPBOARD_ITEMS`. A larger selection
    is refused rather than truncated.
13. The run is bounded by `ONLY_PREVIEW_MAX_DELETE_ENTRIES`; a larger plan is refused with its limit
    before any confirmation.
14. Main still owns the menu, the confirmation and the result; the hidden `fileSearch` preload still
    owns every syscall. No delete API is reachable from the visible renderer.

## Verification Evidence

- `onlyPreviewDeleteSelection.test.mjs` — **PASS 9/9**: the owner's example, per-segment containment
  (`a1/b10` is not inside `a1/b1`), a file never covering a path it prefixes, order and dedup, the
  root refused, every unusable path shape refused.
- `onlyPreviewDeleteDialog.test.mjs` — **PASS 13/13**: the plan is what gets confirmed, single-file
  and single-folder titles, the ten-entry cap, the platform confirm hint, cancel removing nothing,
  stop-on-failure with a partial report, root and oversized plans refused, plus source guards on the
  widened authority and the Main flow.
- `onlyPreviewTreeSelection.test.mjs` — **PASS 13/13**: every gesture, both range directions, the
  root never joining a set, rows dropping out when they disappear, and the renderer wiring.
- `onlyPreviewClipboard.test.mjs` — **PASS 7/7**: the Windows per-path environment variables, the
  macOS argv list, one line per entry for the three text kinds, empty and oversized refused.
- `node --test tests/onlypreview/*.test.mjs`: **744 tests, 738 pass, 6 fail** — the six are the same
  pre-existing failures from concurrent work in this worktree, each confirmed against `git show HEAD:`
  (drawio 800-line budget, Shell live bounds, Shell Project filter, find UI source, renderers empty
  state, root projection).
- `vue-tsc -p tsconfig.web.json`: zero errors in any `onlypreview` file; its 79 remaining errors are
  pre-existing in `home`, `connector` and `poker`.
- Electron E2E: not run.

## Owner Verification

- ⌘-click a few rows, ⇧-click a range, ⌘A: the rows highlight, the preview never moves, and the left
  rail stays on the row the preview came from.
- Right-click inside the selection: Delete reads the count. Right-click outside it: the selection
  collapses to that row first.
- Delete a folder with contents, and a mixed selection that contains both a folder and a file inside
  it — the confirmation should list the folder only.
- Cancel one delete, then confirm one, and check that a previewed file inside a removed folder clears
  the preview.
- Copy a multi-selection and paste it in Finder/Explorer; check Copy Path / Copy Relative Path / Copy
  Name each paste one line per row in tree order.
