# OnlyPreview: locate does nothing when the project root is collapsed

- Status: fixed (2026-09-22)
- Reported: Ral 2026-09-22 —「当 project 根目录都是非展开状态时,点击文件在目录列表中的定位,无效」
- Applies to: `bitterless` and `micromeet-cowork` (the shell renderer is shared)

## Symptom

Collapse the project root, then use "locate in the directory list" on the file being previewed.
Nothing happens — the tree does not expand and the file is never revealed.

## Root cause

`src/renderer/onlypreview/shell/src/onlyPreviewTreeExpansion.store.ts:29-33`

```ts
let current = getOnlyPreviewParentPath(owner.selectedRelativePath);
while (current) {
  owner.expandedPaths.add(current);
  current = getOnlyPreviewParentPath(current);
}
```

**The project root's path is the empty string**, and `while (current)` exits on it — so the root is
never added to `expandedPaths`. Meanwhile `onlyPreviewTree.service.ts:183` renders the root's
children only when the set contains `''`:

```ts
const expanded = expandedPaths.has('');
```

So for `a/b/c.txt` the walk adds `a/b` and `a` and stops; with the root collapsed the tree renders
nothing below it and the reveal has nowhere to land. For a file directly under the root it is worse:
the first parent is already `''`, so the loop body never runs at all.

The root can only be missing from the set by a deliberate user action — `collapse()` (collapse all)
re-adds `''` on purpose (`:18`), so "collapse all" does **not** reproduce this. What reproduces it is
clicking the root row itself, whose toggle deletes the key
(`onlyPreviewShell.store.ts:335-339`). That is exactly the state Ral described.

## Fix

Add the root in `expandSelectedParents`, but **only on the explicit path** (`explicit === true`,
i.e. `locate()` and the reveal at `onlyPreviewShell.store.ts:780`).

Restricting it to the explicit path is deliberate. Six call sites reach this function; the other four
are background consequences (a watch commit inheriting the selection onto a new path, a workspace
projection refresh). Forcing the root open from those would fight a root collapse the user chose,
and it is not needed: those callers only have to leave the expansion set correct for when the user
re-opens the root. An explicit "locate this file" is the one case where the user has asked to see the
file, so the root must open.

## Verification

`tests/onlypreview/onlyPreviewTreeLocate.test.mjs` — locate from a fully collapsed root reveals both
a nested file and a root-level file, and an implicit expansion leaves a collapsed root collapsed.
Red before the fix on the first two cases.
