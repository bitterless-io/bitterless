# OnlyPreview Multi-Select, Copy and Delete

Status: design

Owner request, 2026-09-03: 「目录文件要支持多选 和多选的复制，另外要支持目录和文件的删除，删除也必须弹窗
alert 确认后删除，也可以取消，右击菜单要有删除，删除是直接删除不是进垃圾桶」

Three things change: the Project tree gains a real multi-selection, every copy action operates on it,
and Delete stops being file-only.

## What exists today

[onlypreview-permanent-delete-029](../plan/tasks/onlypreview-permanent-delete-029.md) already ships a
hardened single-**file** permanent delete: a two-phase grant in the hidden `fileSearch` preload, a
pinned file handle, an isolate-then-`unlink` commit, repeated identity re-checks, and a native Main
confirmation. Directories are explicitly refused —
`PATH_NOT_REGULAR_FILE: 'Only regular files can be deleted.'` — and the tree carries one selected row.

This feature keeps that machinery and widens it. It does not loosen any of its checks.

## Selection model

The tree gains an ordered selection plus an **anchor**. The anchor is the row the preview belongs to;
the selection is what an action applies to.

| gesture | selection | anchor | preview |
| --- | --- | --- | --- |
| click | just that row | that row | follows |
| ⌘/Ctrl + click | toggles that row | that row | **unchanged** |
| ⇧ + click | anchor → clicked row, over the flattened visible rows | unchanged | **unchanged** |
| ↑ / ↓ | just that row | that row | follows |
| ⇧ + ↑ / ↓ | extends by one visible row | unchanged | **unchanged** |
| ⌘/Ctrl + A | every visible row | unchanged | **unchanged** |

A multi-select gesture never re-points the preview. Loading a document because the owner is building
a selection is both surprising and expensive — a ⇧-click across forty rows would otherwise start
forty previews.

Range extension walks the **flattened visible** row list, which is what the owner sees; a collapsed
folder's hidden children are not in a range. Selecting a collapsed folder still deletes its whole
subtree, because the folder itself is selected.

Every selected row keeps the existing blue surface
([onlypreview-project-selection-blue-091](../plan/tasks/onlypreview-project-selection-blue-091.md)).
The anchor additionally carries a left rail, so it is always clear which of several selected rows the
preview came from.

A selection is dropped when the workspace changes, when the rows are replaced by a search result
list, or when an entry disappears from the listing — a selection that outlives its rows would let an
action target a path that is no longer there.

## Context menu

The right-clicked row decides the target the way every file manager does:

- inside the current selection → the action applies to the **whole selection**
- outside it → the selection collapses to that row first, then the action applies

So a right-click never acts on rows the owner cannot see are selected. The menu title carries the
count when more than one row is targeted (`Delete 3 Items…`), because a menu that says `Delete…` over
a fourteen-row selection is a trap.

| row | items |
| --- | --- |
| file | Preview · Open in system app · Reveal in folder · Copy File · Copy Path · Copy Relative Path · Copy Name · Rename · **Delete…** |
| folder | Reveal in folder · New Folder · Copy Folder · Copy Path · Copy Relative Path · Copy Name · Rename · **Delete…** |
| root | New Folder · Reveal in folder · Copy Folder · Copy Path · Copy Name |
| multi | Reveal in folder *(anchor only)* · Copy Items · Copy Paths · Copy Relative Paths · Copy Names · **Delete N Items…** |

`Delete…` on a folder row is new. The root is still never deletable and still never renameable.

## Copy

Every copy action becomes selection-wide.

| action | one row | many rows |
| --- | --- | --- |
| Copy File / Copy Folder / Copy Items | one pasteable filesystem reference | one pasteable reference **list** |
| Copy Path | canonical absolute path | one path per line, tree order |
| Copy Relative Path | project-relative path | one per line, tree order |
| Copy Name | basename | one per line, tree order |

The platform adapter in `onlyPreviewClipboard.service.ts` currently writes exactly one path
(`POSIX file (item 1 of argv)` on macOS, a one-element `StringCollection` on Windows). It becomes
list-shaped on both: macOS collects every `argv` item into an AppleScript list, Windows adds one
entry per indexed environment variable. Neither reads file bytes, and the existing timeout, output
cap, `shell: false`, and no-absolute-path-to-renderer rules are unchanged. The list is bounded by
`ONLY_PREVIEW_MAX_CLIPBOARD_ITEMS`; a larger selection fails visibly rather than truncating, because a
silently truncated paste is worse than a refused one.

`⌘C` / `⇧⌘C` / `⌥⌘C` keep their meanings and now cover the whole selection.

## Delete

### Collapse

`collapseOnlyPreviewDeleteSelection` in
[`onlyPreviewDeleteSelection.shared.ts`](../../src/shared/onlypreview/onlyPreviewDeleteSelection.shared.ts)
turns the raw selection into the entries to remove. Owner rule: 「删除 a1/b1/c1 和 a1/b1 以及 a2/ 时，
实际要处理过滤然后只删除 a1/b1 和 a2」.

```text
selected            a1/b1/c1   a1/b1   a2
                       │         │      │
                    covered      ✓      ✓
plan                          a1/b1   a2
```

An entry is dropped when any **other selected directory** is one of its ancestors. Containment is
tested per path segment, so `a1/b10` is not inside `a1/b1`. Only a directory can cover another entry;
a file whose path is a string prefix of another path never does. The workspace root is refused
outright rather than collapsing the selection into "delete the project".

Removing the descendant first would either fail — its parent is already gone — or race the recursive
removal, so the collapse is a correctness requirement, not a nicety.

### Confirmation

The alert dialog from [onlypreview-alert-dialogs](onlypreview-alert-dialogs.md), showing the
collapsed plan. It replaces the native `dialog.showMessageBox` used by the single-file path, so one
dialog surface covers every delete. `Cancel` holds focus; `⌘⏎` confirms; `Esc` cancels. Cancelling
performs no syscall and leaves the selection intact.

### Execution

Entries are removed one at a time, each through the existing two-phase grant. The commit is widened,
not replaced:

| step | file (today) | directory (new) |
| --- | --- | --- |
| pin identity | open a handle, compare `dev`/`ino` | re-`lstat` and compare `dev`/`ino` |
| isolate | rename into a private `.bitterless-delete-recovery-<uuid>` sibling | same |
| re-check | isolated entry is a regular file, contained, same identity | isolated entry is a directory, contained, same identity |
| remove | `unlink` | `rm` recursive, no symlink following |
| restore on failure | rename back | rename back |

A directory cannot be pinned by a file handle — `open()` on a directory fails on Windows — so the
directory path pins identity by `dev`/`ino` re-checked immediately before the isolate rename. The
isolate step is the real protection either way: once renamed, the subtree is unreachable by its
original path, so a concurrent rename cannot redirect the recursive removal.

`rm` recursive unlinks symbolic links rather than following them, so a link inside a deleted folder
never reaches its target.

The run is bounded by `ONLY_PREVIEW_MAX_DELETE_ENTRIES`. A failure **stops the run** and reports what
was removed and what was not, through the error dialog, naming the entry that failed. A partial
delete is reported as a partial delete; it is never presented as success.

### After a delete

- If the previewed file was removed — directly, or because it was inside a removed directory — the
  preview clears, its revision-owned assets and documents are revoked, and an empty presentation is
  published. This widens the existing exact-path rule to subtree containment.
- The selection drops every removed entry.
- The `fileSearch` watcher converges the tree and the search index through the same path as any
  external filesystem change; the delete additionally nudges the listing so rows disappear without
  waiting for watch latency.

### What stays refused

Symbolic links, the workspace root, paths outside the active workspace, a stale
workspace generation, an entry whose identity changed since the grant, and any Trash fallback. There
is still no wildcard, no retry loop, and no delete API reachable from the visible renderer — Main
owns the menu, the confirmation and the result; the hidden `fileSearch` preload owns every syscall.

## Delivery

[onlypreview-multi-select-delete-121](../plan/tasks/onlypreview-multi-select-delete-121.md).
