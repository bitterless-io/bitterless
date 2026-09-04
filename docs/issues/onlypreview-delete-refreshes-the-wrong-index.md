# OnlyPreview — a delete refreshes the search index, but the tree is drawn from the browse projection

- Status: open
- Found: 2026-09-04 13:15, owner report on a build that **does** contain the delete announcement fix
  ([onlypreview-delete-never-tells-the-tree](./onlypreview-delete-never-tells-the-tree.md), `82d826c`)
- Severity: a deleted folder keeps its row for as long as a full re-index takes, and every action on
  that row fails

Owner report:

> 我删除了目录和文件，只有文件不再显示目录还在显示，但实际已删除再次点击目录报错
> 所以 ui 更新的太慢了，我发现删除过了很久才更新

```
13:15:02.015 › [onlypreview] operation=showFileContextMenu errorCode=PATH_NOT_FOUND
```

This is a **different defect** from the announcement bug. That one was "nothing is told to the
shell". This one is "the shell is told, and then refreshes something that does not draw the tree".

## Root cause

The tree renders `onlyPreviewShellStore.index`, and that value has exactly one writer:

```ts
// onlyPreviewShell.store.ts — commitBrowseProjectionResult
this.index = result.index;                     // the BROWSE PROJECTION
```

`index` is assembled by `OnlyPreviewBrowseProjectionService` out of `browseDirectory` listings. It is
never assigned from a search snapshot — `applySearchSnapshot` only moves loading state and then
re-fetches listings for the parents of the **selected** path:

```ts
private async applySearchSnapshot(snapshot) {
  …
  this.expandSelectedParents();
  await this.loadSelectedParentListings();     // only the SELECTED path's ancestors
}
```

`settleDeletedEntries` refreshes the other index:

```ts
await this.host.refreshIndex();                // → search runtime `refresh`
```

which runs a **full workspace re-index** — `countWorkspaceSearchEntries` over the whole root plus
`buildAndPromoteCandidate` (`search-engine.mjs` `refreshInternal`), queued behind whatever the
filesystem watcher already had in flight. That is the "过了很久".

So the two observed halves follow exactly:

| what was deleted | why |
| --- | --- |
| a **file** — row disappears | it was the selected path, so `loadSelectedParentListings()` re-fetched its parent's listing |
| a **folder** — row stays | nothing re-fetches the folder's parent listing; the projection still holds the row |
| eventually correct | the watcher's own reconcile lands later and rewrites the listing |

The shell was holding the answer the whole time. `ONLY_PREVIEW_PROJECT_DELETE_EVENT` carries
`relativePaths` — the exact set that was removed — and `settleDeletedEntries` used it only to prune
selection pointers, then threw it away and asked for a full rescan of the disk to rediscover the
same fact.

## Fix

**Drop the removed rows from the projection first, then refresh.** The projection already knows how
to detach a subtree (`removeSubtree`, used when a listing comes back without a folder it used to
have); it just was never reachable from a delete.

`OnlyPreviewBrowseProjectionService.removeDeletedPaths(relativePaths, workspaceId, expandedPaths)`:

- splices each removed path out of **its parent's listing array** — that array is what renders the
  row, and `removeSubtree` alone does not touch it (it drops the folder's own listing and tokens);
- calls `removeSubtree` for each removed path, so descendant listings, directory tokens and
  `expandedPaths` go with it;
- rebuilds the projection and reports whether anything changed.

Containment is the segment walk `path === p || path.startsWith(`${p}/`)` already used in
`removeSubtree`, so `a1/b10` never dies with `a1/b1`.

`refreshIndex()` still runs afterwards, unchanged — it reconciles the search index and repairs the
projection if our local removal was somehow wrong. It is no longer on the path between the delete
and the row disappearing.

## Verification

- `tests/onlypreview/onlyPreviewBrowseProjectionDelete.test.mjs` — a file, a folder with children,
  a deep descendant, the `a1/b10` sibling that must survive, an unknown path that must be a no-op,
  and the root `''` which must never match.
- `tests/onlypreview/onlyPreviewProjectMutationRefresh.test.mjs` — extended: the delete settle must
  drop the rows **before** it awaits `refreshIndex`, because that call is a full workspace rescan.
