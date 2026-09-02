---
id: onlypreview-watch-stable-project-and-preview-107
scope: keep the OnlyPreview Project tree and Preview stable across watch reconciles, and relocate the tree selection when the selected item is deleted
status: implemented; owner verification pending
depends-on: [onlypreview-selected-file-index-priority-034]
verify: node --test tests/onlypreview/onlyPreviewBrowseIndex.test.mjs tests/onlypreview/onlyPreviewSearchEngine.refresh.test.mjs tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewPreviewWatchCommit.test.mjs
---

# OnlyPreview Watch-Stable Project And Preview

## Objective

An ordinary file update anywhere in the Project must leave the visible UI alone: the Project tree
keeps its selection, its expanded directories, and its scroll position, and the Preview keeps the
surface it has already mounted. Only a change to the previewed file itself may rerender it, and
only deletion of the selected item may move the tree selection.

Issue:
[onlypreview-watch-update-resets-project-and-preview](../../issues/onlypreview-watch-update-resets-project-and-preview.md).

## Contract

1. `OnlyPreviewBrowseIndex.setSearchPolicy(policy)` recomputes `ancestorBlocked` for every issued
   capability from the new policy, keeping each path's token identity and its `listedPaths` state.
   `ancestorBlocked(P)` stays `blocked(parent(P)) || (isExcludedDirectoryPath(P) &&
   !canTraverseExcludedDirectoryPath(P))`, with the root unblocked.
2. `OnlyPreviewBrowseIndex.listedDirectoryPaths()` reports the directories already listed for the
   current workspace so the engine can republish exactly those.
3. `refreshInternal()` does not reset browse capabilities on either the success or the recovery
   path. Both paths publish `emitOpenBrowseListings()`: the root listing first, then one listing per
   other already-listed directory in ascending depth order. A directory that vanished during the
   rebuild fails silently; its removal is already carried by its parent's listing.
4. `OnlyPreviewPreviewRegionService.handleWatchCommit` keeps the existing bounded-commit path
   filter. Before re-presenting it resolves the selected item once through
   `onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef` +
   `fileSearchWindowService.authorizeProjectItem` and re-presents only when the presented
   descriptor is absent or names another path, the authority call fails, the item is not a regular
   file, or `size`/`modifiedAt` differ. It never re-presents an unchanged selected file.
5. `resolveOnlyPreviewDeletedSelection(previousRows, deletedPath, hasEntry)` is a pure Shell service
   returning the row that inherits the selection: the first following row that still exists and is
   not a descendant of the deleted path, otherwise the nearest such preceding row, otherwise the
   closest surviving ancestor, otherwise the root row `''`.
6. `resolveOnlyPreviewProjectionCommit` decides one browse-projection commit off the store: the
   sanitized error message for a result that still belongs to the active workspace/generation, and
   the inheriting row when the committed projection removes the entry named by
   `treeSelectedRelativePath`. `OnlyPreviewShellStore.centerTreeRow` then applies the inheriting row
   to `treeSelectedRelativePath`/`focusedRelativePath`, reports the Global Search context, and
   centres it through the existing `centerProjectRelativePath`/`centerProjectRevision` channel — the
   same path the Global Search directory reveal already used. `selectedRelativePath` is untouched,
   so the Preview keeps reporting the deleted file's typed missing state.
7. `onlyPreviewSelectedFileChanged` carries rule 4's authority read, keeping the Preview Region and
   the Shell store inside their 800-line source budgets.

## Out of scope

- The macOS `fs.watch` behaviour of reporting every change as `rename`, and the resulting escalation
  of deletes/renames/temp-file saves to a full reconcile.
- Restoring in-surface scroll position when the previewed file genuinely changed.

## Verify

- `node --test tests/onlypreview/onlyPreviewBrowseIndex.test.mjs` — a policy swap keeps issued
  tokens usable and refreshes their exclusion state.
- `node --test tests/onlypreview/onlyPreviewSearchEngine.refresh.test.mjs` — a refresh keeps the
  root token, republishes every open directory with the deletion applied, and leaves an old child
  token usable. Reverting the engine to `reset()` + root-only publication fails it.
- `node --test tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs` — a failed config
  refresh still swaps exclusion markers, now under one stable root capability.
- `node --test tests/onlypreview/onlyPreviewSearchShell.test.mjs` — deleted-selection relocation
  picks the next, previous, ancestor, and root rows in that order.
- `node --test tests/onlypreview/onlyPreviewPreviewWatchCommit.test.mjs` — an unrelated bounded
  commit never reads the authority, a full commit on an unchanged file does not re-present, a moved
  `size`/`modifiedAt` re-presents once and then settles, and a deleted file reaches the typed
  missing state. Removing the identity guard fails it.
- `node --test tests/onlypreview/*.test.mjs` — 591/596; the five remaining failures
  (`onlyPreviewFindRenderer` 440, `onlyPreviewSearchShellUi` 5 and 19, `onlyPreviewSearchUtilityRpc`
  233, `onlyPreviewSourceIntegration` 397) fail identically on an unmodified `HEAD` checkout.
- `yarn typecheck` — no OnlyPreview diagnostic; the repository's unrelated pre-existing errors
  (`home/chat`, `maestro`, `omni`, `shared/pathHelper`) are unchanged.
- `yarn eslint` on every changed TypeScript/Vue file — clean. The two `search/core/*.mjs` files keep
  the directory's pre-existing `explicit-function-return-type` findings, which an untouched sibling
  (`watch-controller.mjs`) already reports. A tree-wide `eslint src/main/onlypreview
  src/renderer/onlypreview` aborts the Node process (SIGABRT) before reporting and gives no verdict
  either way.
- esbuild bundle-resolution of the three changed module graphs (Preview Region under
  `tsconfig.node.json`, Shell store under `tsconfig.web.json`, `search-engine.mjs`) — every new
  import and alias resolves.
- `yarn build` not run: `scripts/before.js` carries another session's uncommitted work and the build
  writes the shared `out/` directory, so running it here could collide with that session.
- Electron E2E not run (owner policy: never launch Electron E2E unprompted).
