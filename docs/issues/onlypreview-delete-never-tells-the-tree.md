# OnlyPreview — a delete never tells the tree, so removed rows stay on screen

- Status: fixed, awaiting owner verification
- Found: 2026-09-04, owner report immediately after the folder-delete repair
  ([onlypreview-folder-delete-leaves-a-recovery-directory](./onlypreview-folder-delete-leaves-a-recovery-directory.md))
- Severity: every action on a deleted row fails, and the failures look unrelated to each other

Owner report:

> 1. 删除报错：`operation=showFileContextMenu errorCode=PATH_NOT_FOUND`
> 2. 复制被删除的内容路径也报错 (screenshot: "The operating system could not copy this item.")
> 3. 删除之后内容仍然显示，所以我点击再次删除也是报错

## Root cause

Three symptoms, one cause: **§3 causes §1 and §2.**

Every Project mutation Main performs has to hand its result back to the shell, because the native
context menu and the alert-layer dialogs run entirely in Main and nothing returns to the renderer
the way an ordinary call does. New Folder and Rename each do that with a broadcast:

```ts
xpcMain.broadcast(ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT, { hostId, workspaceId, relativePath });
xpcMain.broadcast(ONLY_PREVIEW_PROJECT_RENAME_EVENT,     { hostId, workspaceId, relativePath });
```

Delete had no such event at all — `ONLY_PREVIEW_PROJECT_DELETE_EVENT` did not exist.
`deleteProjectSelectionFromMenu` discarded its outcome entirely:

```ts
await presentOnlyPreviewDeleteDialog(…).catch(() => undefined);   // nothing announced
```

So the files were removed from disk and the tree kept rendering their rows. Everything the owner
then did to one of those rows acted on a path that was gone:

| what the owner did | what failed |
| --- | --- |
| right-click a removed row | `showFileContextMenu` → `PATH_NOT_FOUND` (§1) |
| Copy on a removed row | `authorizeCopyItem` throws → our own `copyFailureMessage`, "The operating system could not copy this item." (§2) |
| Delete a removed row again | the same `PATH_NOT_FOUND` (§3) |

The copy dialog is our string (`src/renderer/common/i18n/en.ts`), not a macOS one — it just reads
like one, which is why it looked like a separate bug.

## Fix

`ONLY_PREVIEW_PROJECT_DELETE_EVENT` carries **what was actually removed**, not one path, because a
delete run removes a whole collapsed selection:

```ts
export interface OnlyPreviewProjectDeleteEvent extends OnlyPreviewHostEvent {
  workspaceId: string;
  relativePaths: string[];
}
```

Main announces it from `outcome.removed` rather than from "the run finished" — a run that stopped at
a failure still removed everything before it, and those rows have to go too.

The shell drops every pointer *into* a removed folder before re-reading the index, so the tree never
renders a frame that still selects or expands a row that no longer exists: `expandedPaths`,
`selectedRelativePath`, `focusedRelativePath` and `treeSelectedRelativePath`. The multi-selection
needs no help — it is already retained against the visible rows whenever their count changes.

Containment is the shared segment walk, `isOnlyPreviewPathRemoved`, rather than a local
`startsWith`, so `a1/b10` is never read as living inside `a1/b1` — the same rule the delete collapse
uses.

## Verification

- `tests/onlypreview/onlyPreviewDeleteSelection.test.mjs` — the removal rule by segment: a folder,
  its children, deep descendants, and the sibling `a1/b10` that must survive; plus the root `''` and
  an empty run, neither of which may match.
- `tests/onlypreview/onlyPreviewProjectMutationRefresh.test.mjs` — new, and the guard that would
  have caught this: **every** Project mutation Main performs must declare an event, broadcast it,
  and be subscribed to in the shell. New Folder and Rename were never guarded either, which is how
  Delete shipped without one.
