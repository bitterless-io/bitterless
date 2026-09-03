# Shift+Cmd+C Works on a Folder Row and Not on a File Row

Status: fixed; owner verification pending

## Symptom

`Shift+Cmd+C` (Copy Path) copies when a directory row is selected in the Project tree and does
nothing when a file row is selected.

## Root cause

`Shift+Cmd+C` exists **only** as a DOM keydown handler in the shell renderer —
`handleProjectItemCopyShortcut` in `src/renderer/onlypreview/shell/src/App.vue`, bound through
`@keydown.capture` — and it is gated twice: the key has to reach the shell document at all, and
`event.target` has to be the tree-row button
(`!target.matches('button[name="onlypreview__treeRow"]')` returns early otherwise).

Every other window-wide OnlyPreview shortcut — `find-in-file`, `focus-project`, `focus-search` — is
Main-owned through `before-input-event`, bound on all four views precisely so it survives focus
living anywhere. The copy shortcuts were never given that treatment.

Selecting a file is the only tree action that materializes a second focusable view over the preview
region; `activateEntry` returns early for a directory, so a folder selection mounts nothing and the
shell keeps focus. Once the preview view exists, every ordinary use of it — clicking into the
document to scroll or select, `Cmd+F` then `Esc` (which explicitly calls `focusActiveContent`),
closing Global Search in `preview` mode — moves the window's focus off the shell, and the keystroke
never becomes a DOM event there.

Two things this is **not**, both checked: nothing on the selection path itself calls `focus()`
(`focusActiveContent` is defined once and has exactly three callers, none of them reachable from
`selectStandaloneFile`), and nothing downstream of the handler branches on node kind —
`copyProjectItemFromUi` and `OnlyPreviewClipboardService.copyProjectItem` are node-kind agnostic,
and the context menu's Copy Path works on a folder row. The file/folder split can only be a
focus-ownership split.

## Repair contract

- Copy Path (`Shift+Cmd/Ctrl+C`) and Copy Name (`Alt+Cmd/Ctrl+C`) become Main-owned native
  shortcuts, matched by `isProjectItemCopyShortcut` beside the existing predicates and returned from
  `resolveNativeCommand` as `copy-project-path` / `copy-project-name`. They reach the shell as
  `ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT`, because only the shell knows which row is selected.
- Exactly one of Shift/Alt qualifies, reproducing the renderer's existing XOR: `Shift+Alt+Cmd+C` is
  not a copy.
- Plain `Cmd+C` stays renderer-owned and unchanged. Inside a document it means "copy the selection",
  and Main must not take that key.
- The shortcut is ignored while Global Search is active, so a keystroke typed into the search field
  is not stolen from it.
- Main does not move focus when it handles a copy: a copy must not pull the owner out of the
  document they are reading.
- The renderer handler now returns early for the Shift and Alt variants, so the two paths cannot
  both fire even if a future change stops Main from consuming the key.

Delivery: [onlypreview-project-copy-shortcuts-116](../plan/tasks/onlypreview-project-copy-shortcuts-116.md).
