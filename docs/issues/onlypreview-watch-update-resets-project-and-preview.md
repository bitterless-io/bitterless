# OnlyPreview Loses Project Tree Position And Rerenders An Unchanged Preview On A File Update

Status: implemented; owner verification pending

## Symptom

While a Project is open and one file is selected, an ordinary filesystem update anywhere in that
Project makes the visible state jump:

- the left Project tree collapses back to the workspace root plus the selected file's ancestor
  chain, so every other directory the user had expanded closes and the tree scrolls to the very
  top;
- the right Preview tears down and rebuilds the selected file even when that file was not touched.

The UI must survive any file or index change: the current tree selection, expansion, and scroll
position stay exactly where they are, and the Preview keeps its rendered surface. The only
exception is deletion of the selected item.

## Root cause

Two independent defects, both reached by the same trigger.

### Trigger — macOS turns ordinary edits into full reconciles

The workspace watcher is `fs.watch(root, { recursive: true })`
(`src/preload/onlypreview/search/core/watch-controller.mjs:185`). On macOS every event arrives as
`eventType: 'rename'`, verified directly:

```text
modify existing file in place   -> rename :: docs/plan/a.md
atomic write (tmp + rename)     -> rename :: docs/plan/.a.md.tmp , rename :: docs/plan/a.md
create new file                 -> rename :: docs/plan/c.md
delete file                     -> rename :: docs/plan/b.md
create dir                      -> rename :: docs/plan/sub
```

`OnlyPreviewSearchWatchReconciler.apply` therefore sets `renameHint` for every path, and a path that
no longer exists at the 400ms trailing edge (`ENOENT` + `renameHint`) or a path that resolves to a
directory forces `requiresFullReconcile`
(`src/preload/onlypreview/search/core/watch-reconciler.mjs:215,259`). Deleting a file, saving
through a temp file, renaming, and creating a directory each escalate to
`refreshFromWatchInternal()` plus a `full: true` watch commit. This is the ordinary case, not an
edge case.

### Defect 1 — a full reconcile rotates every browse capability, and the Shell reads that as "root replaced"

`refreshInternal()` calls `this.browseIndex.reset()` unconditionally
(`src/preload/onlypreview/search/core/search-engine.mjs:585`, and again at `:622` on the recovery
path). `reset()` clears `tokenByPath`/`pathByToken`/`listedPaths` and mints a new root
`directoryToken` (`src/preload/onlypreview/search/core/browse-index.mjs:75`), then
`emitRootBrowseListing()` publishes the root listing under that new token.

In the Shell, `OnlyPreviewBrowseProjectionService.applyListing` treats a changed root token as a
workspace replacement and calls `clear(expandedPaths)`
(`src/renderer/onlypreview/shell/src/onlyPreviewBrowseProjection.service.ts:88`), which wipes every
cached directory listing **and the caller's whole `expandedPaths` set**. The projection is rebuilt
from the root listing alone, so `visibleRows` shrinks to root plus its direct children; the tree's
scroll container content shrinks with it and the browser clamps `scrollTop` to `0`. Only afterwards
does the store re-add `''` and the selected file's ancestors and reload that one chain
(`onlyPreviewShell.store.ts:commitBrowseProjectionResult`, `applyBrowseListing`). Every other
expanded directory is gone and the scroll position is not recoverable.

Directory tokens are per-path capabilities whose only policy-dependent field is `ancestorBlocked`.
A content reconcile changes neither the path set nor the search policy, so rotating them carries no
correctness benefit — it only destroys Shell state.

### Defect 2 — a full watch commit re-presents the selected file without checking it

`OnlyPreviewPreviewRegionService.handleWatchCommit` re-presents whenever `commit.full === true`,
with no test of whether the selected file changed
(`src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:276`). `present()` advances the
selection revision, revokes the old surface authority, and remounts the renderer. So any unrelated
delete/rename/temp-file save in the Project rebuilds the preview of an untouched file.

## Repair contract

1. **Browse capabilities survive a reconcile.** `OnlyPreviewBrowseIndex.setSearchPolicy` recomputes
   `ancestorBlocked` for every already-issued capability instead of leaving it stale, and
   `refreshInternal()` no longer calls `reset()`. Tokens, and therefore the Shell's tree, stay
   valid across every full reconcile and manual refresh. `reset()` remains the workspace-level
   revocation primitive and keeps its current semantics.
2. **A full reconcile republishes what the Shell has open.** After a rebuild, the engine emits a
   fresh listing for the root *and* for every directory already listed for this workspace, parents
   before children. Deletions and additions inside expanded directories therefore reach the tree
   through in-place listing replacement rather than through a collapse.
3. **Preview rerenders only when the previewed file changed.** `handleWatchCommit` still ignores a
   bounded commit that does not name the selected path. For a commit that does reach the selected
   file — including every `full` commit — Main reads the selected item's current authority metadata
   once and re-presents only when the file is missing, is no longer a regular file, or its
   `size`/`modifiedAt` differ from the presented descriptor. An unchanged file keeps its mounted
   surface, its selection revision, and its find state.
4. **Deleted selection relocates the tree.** When the entry the tree has selected disappears from
   the Project projection, the Shell moves the tree selection and focus to the nearest surviving
   row — the next visible row that is not a descendant of the deleted path, otherwise the previous
   such row, otherwise the closest surviving ancestor — and scrolls it into view through the
   existing centre-on-path channel. Expansion state and the rest of the tree are untouched. The
   Preview keeps reporting the deleted file through its typed missing state and never renders the
   deleted content.
5. Nothing else changes: no new Main API, no Main filesystem walk, no additional watch, no change
   to search scope, exclusion markers, or find fencing.

## Known limits

- `size` + `modifiedAt` is millisecond-resolution identity. A rewrite that keeps the byte count and
  lands inside the same millisecond as the presented read is not detected; the next change to that
  file corrects it.
- The macOS `rename`-for-everything escalation to full reconcile is left in place. It is a cost
  question for the index, not a UI-correctness one, once this repair lands.

Delivery:
[onlypreview-watch-stable-project-and-preview-107](../plan/tasks/onlypreview-watch-stable-project-and-preview-107.md).
