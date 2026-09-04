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

1. The tree carries an ordered selection plus an anchor. The anchor is the last row the owner
   clicked, plainly or with ⌘/Ctrl; a ⇧ click never moves it, so ranging again re-aims the range from
   the same point instead of walking it. A ⇧ range replaces the selection rather than adding to it.
   Only a plain click and a plain arrow key re-point the preview.
2. A range walks the flattened **visible** rows — the tree's one-dimensional order — recomputed on
   every gesture, so expanding or collapsing a folder re-aims the next range with no state to keep in
   step. A collapsed folder's hidden children are not in a range; selecting the folder still removes
   its whole subtree, because the folder is the entry.
3. The left rail marks the **previewed** row, not the anchor: a ⌘ click moves the anchor without
   loading a document, and the rail exists to say where the shown content came from.
4. New Folder and Rename are disabled while several rows are targeted. Creating inside several
   folders at once, or renaming several rows to one name, has no meaning.
5. The workspace root never joins a multi-selection, and a selection whose rows disappear drops them.
6. The right-clicked row decides the target: inside the selection the action covers all of it,
   outside it the action covers that row alone. Delete reads `Delete N Items…` when more than one row
   is targeted.
7. The selection travels with the context-menu request and is re-validated in Main. Every entry is
   re-authorized per entry before any syscall — this payload only decides what the menu offers.
8. `collapseOnlyPreviewDeleteSelection` drops every entry covered by another selected **directory**,
   testing containment per path segment. The root is refused rather than collapsed.
9. One alert-layer confirmation covers the whole plan, listing what will actually be removed. The
   native `dialog.showMessageBox` delete confirmation is gone.
10. Entries are removed one at a time through the existing two-phase grant. A failure stops the run
   and reports how many were removed and which entry failed; a partial delete is never reported as a
   success.
11. A directory is removed by isolate-then-`rm -r`: pinned by `dev`/`ino` (a directory cannot hold a
   descriptor on Windows), renamed into the private recovery directory, re-checked, then removed.
   `rm` unlinks symbolic links instead of following them.
12. A directory's identity is `dev` + `ino` only. Its `size` and `mtime` change whenever a child
    changes, so comparing them would fail the confirmation for an ordinary background write.
13. A previewed file inside a removed folder clears the preview, not only an exact path match.
14. Every copy action covers the selection: one pasteable list for `item`, one line per entry in tree
    order for the three text kinds, bounded by `ONLY_PREVIEW_MAX_CLIPBOARD_ITEMS`. A larger selection
    is refused rather than truncated.
15. The run is bounded by `ONLY_PREVIEW_MAX_DELETE_ENTRIES`; a larger plan is refused with its limit
    before any confirmation.
16. Main still owns the menu, the confirmation and the result; the hidden `fileSearch` preload still
    owns every syscall. No delete API is reachable from the visible renderer.

## Verification Evidence

- `onlyPreviewDeleteSelection.test.mjs` — **PASS 9/9**: the owner's example, per-segment containment
  (`a1/b10` is not inside `a1/b1`), a file never covering a path it prefixes, order and dedup, the
  root refused, every unusable path shape refused.
- `onlyPreviewDeleteDialog.test.mjs` — **PASS 13/13**: the plan is what gets confirmed, single-file
  and single-folder titles, the ten-entry cap, the platform confirm hint, cancel removing nothing,
  stop-on-failure with a partial report, root and oversized plans refused, plus source guards on the
  widened authority and the Main flow.
- `onlyPreviewTreeSelection.test.mjs` — **PASS 18/18**: every gesture, both range directions, the
  owner's ⌘2 ⌘6 ⇧1 ⇧3 sequence, the anchor surviving a click that empties the selection, the range
  following an expand/collapse, the anchor living outside `treeSelectedRelativePath`, New Folder and
  Rename inert for a multi-selection, the root never joining a set, rows dropping out when they
  disappear, and the renderer wiring.
- `onlyPreviewClipboard.test.mjs` — **PASS 7/7**: the Windows per-path environment variables, the
  macOS argv list, one line per entry for the three text kinds, empty and oversized refused.
- `node --test tests/onlypreview/*.test.mjs`: **749 tests, 743 pass, 6 fail** — the six are the same
  pre-existing failures from concurrent work in this worktree, each confirmed against `git show HEAD:`
  (drawio 800-line budget, Shell live bounds, Shell Project filter, find UI source, renderers empty
  state, root projection).
- `vue-tsc -p tsconfig.web.json`: zero errors in any `onlypreview` file; its 79 remaining errors are
  pre-existing in `home`, `connector` and `poker`.
- Electron E2E: not run.

## Owner Verification

- ⌘-click 2 then 6, ⇧-click 1 (expect 1-6), then ⇧-click 3 (expect 3-6): the range re-aims from 6
  rather than walking, the preview never moves, and the left rail stays on the previewed row.
- Expand a folder inside a range and ⇧-click again: the newly visible children join the range.
- With several rows selected, New Folder and Rename are greyed out.
- Right-click inside the selection: Delete reads the count. Right-click outside it: the selection
  collapses to that row first.
- Delete a folder with contents, and a mixed selection that contains both a folder and a file inside
  it — the confirmation should list the folder only.
- Cancel one delete, then confirm one, and check that a previewed file inside a removed folder clears
  the preview.
- Copy a multi-selection and paste it in Finder/Explorer; check Copy Path / Copy Relative Path / Copy
  Name each paste one line per row in tree order.
