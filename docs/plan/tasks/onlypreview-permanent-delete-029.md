---
id: onlypreview-permanent-delete-029
scope: Project item native menu with pasteable copy, path/name copy, and permanent file deletion
status: implemented; owner verification pending
depends-on: [onlypreview-shell-ux-005, onlypreview-design-completion-025]
verify: node --test tests/onlypreview/*.test.mjs && yarn check:renderer-i18n && yarn build
---

# Project item copy and permanent file deletion

## Objective

Extend the existing Main-owned Project context menu to regular files and directories. Both can be
revealed and copied as pasteable filesystem items or as absolute-path, project-relative-path, and
name text. After a native confirmation, Delete removes the exact authorized regular file directly
from disk; it does not move the file to the operating-system Trash. Directory rows, the workspace
root, symbolic links, and paths outside the active workspace remain non-deletable.

## Context

- [`../../features/onlypreview.md`](../../features/onlypreview.md) — current capability, native menu,
  Preview Region, and file-watch contracts.
- [`onlypreview-shell-ux-005`](onlypreview-shell-ux-005.md) — introduced the Main-owned native file
  action menu.
- [`onlypreview-design-completion-025`](onlypreview-design-completion-025.md) — closed absolute-path
  disclosure and established the current Main/Shell action ownership.

## Path

- `src/main/xpc/onlyPreview.handler.ts`
- `src/main/onlypreview/onlyPreviewClipboard.service.ts`
- `src/main/onlypreview/onlyPreviewSelectionCoordinator.service.ts`
- `src/main/onlypreview/onlyPreviewWorkspace.registry.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/components/ProjectSearchResults/ProjectSearchResults.vue`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs`
- `tests/onlypreview/onlyPreviewClipboard.test.mjs`
- `tests/onlypreview/onlyPreviewSelectionCoordinator.test.mjs`
- `tests/onlypreview/onlyPreviewAppWiring.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`
- `tests/onlypreview/runtime.entry.ts`
- `tests/onlypreview/specs/onlyPreviewActions.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-permanent-delete-029.md`
- `docs/plan/reviews/onlypreview-permanent-delete-029-1.md`
- `docs/plan/reviews/onlypreview-permanent-delete-029-2.md`
- `docs/plan/reviews/onlypreview-permanent-delete-029-3.md`

## Frontend Design

The action stays in the existing native menu, visually separated from non-destructive commands.
No toolbar button or in-content overlay is added.

```text
regular file — right click
┌─────────────────────────┐
│ Preview                 │
├─────────────────────────┤
│ Open in system app      │
│ Reveal in folder        │
├─────────────────────────┤
│ Copy File          ⌘C   │
│ Copy Path        ⇧⌘C   │
│ Copy Relative Path      │
│ Copy Name        ⌥⌘C   │
├─────────────────────────┤
│ Delete…                 │
└─────────────────────────┘

directory — right click
┌─────────────────────────┐
│ Reveal in folder        │
├─────────────────────────┤
│ Copy Folder        ⌘C   │
│ Copy Path        ⇧⌘C   │
│ Copy Relative Path      │
│ Copy Name        ⌥⌘C   │
└─────────────────────────┘

Delete…
┌──────────────────────────────────────────────────┐
│ Permanently delete this file from disk?          │
│ filename.ext                                     │
│ This action cannot be undone.                    │
│                              [Cancel] [Delete]   │
└──────────────────────────────────────────────────┘
```

`Cancel` is the default and cancel action. `Delete` is marked destructive. The dialog is parented
to the active OnlyPreview `BaseWindow`, and all copy is localized. On Windows/Linux the displayed
accelerators use Ctrl/Alt equivalents.

## Contract

1. Only an existing non-symlink regular file or directory reached through the current content host,
   opaque workspace capability, normalized relative path, and canonical realpath containment may
   expose the Project item menu. Symbolic links and the workspace root expose no menu.
2. Regular files expose Preview, Open in system app, Reveal in folder, Copy File, Copy Path, Copy
   Relative Path, Copy Name, and Delete. Directories expose Reveal in folder, Copy Folder, Copy Path,
   Copy Relative Path, and Copy Name; they never expose Preview/Open/Delete.
3. `Copy File`/`Copy Folder` writes one native filesystem reference that can be pasted into the
   operating-system file manager. It never reads or duplicates the target bytes. Because Electron's
   clipboard API has no portable file-list writer, Main owns a bounded platform adapter: macOS uses
   `/usr/bin/osascript`, Windows uses STA PowerShell `Clipboard.SetFileDropList`, and unsupported
   Linux desktop integration fails visibly instead of claiming a text path is a pasteable file.
4. Copy Path writes the canonical absolute path as plain text; Copy Relative Path writes the
   normalized path relative to the active workspace root; Copy Name writes only the basename. Main
   resolves and writes the value directly, and no absolute path is returned to a renderer.
5. With focus on a Project tree/search-result item and not an input/editor/contenteditable control,
   `Cmd/Ctrl+C` copies the filesystem item, `Shift+Cmd/Ctrl+C` copies its absolute path, and
   `Option/Alt+Cmd/Ctrl+C` copies its name. The relative-path action is menu-only. These shortcuts
   never replace ordinary text copy in Preview content, the Project search/filter input, or another
   interactive control.
6. The visible renderer receives no filesystem deletion API. It may send one narrow
   capability-scoped copy intent for the focused Project item; Main owns every resolved clipboard
   write. Main also owns the menu's Delete item, confirmation, final revalidation, unlink, and error
   dialog.
7. Selecting `Delete…` is not authorization to mutate. Main re-resolves the file for display, then
   requires an explicit native confirmation. Cancel/default, window close, or a stale file leaves
   disk and UI state unchanged.
8. After confirmation, Main opens and identity-checks the exact file again, closes the handle for
   Windows compatibility, rechecks canonical path/identity immediately before `unlink`, and deletes
   only that file. There is no recursive operation, wildcard, symlink-target delete, directory
   delete, Trash fallback, or retry loop.
9. Only after a successful delete does Main invalidate in-flight selection work for that exact
   workspace/path. If that exact file remains selected, Main clears the workspace selection and
   active Preview Region, revokes revision-owned assets/documents, and publishes the resulting empty
   presentation plus selection snapshot without reinitializing the whole workspace/index. Deleting
   another or superseded file preserves the current selection and preview. The existing hidden
   `fileSearch` watcher converges tree and Project Search rows.
10. A failed copy or delete preserves workspace selection and Preview state and shows one parented
   localized native error. Error text contains no absolute path or file content.
11. Copy/delete work is constant-space and bounded to one descriptor, at most one short-lived OS
   clipboard helper process, one file handle, one metadata comparison, and one `unlink`; it must
   never read file contents or recursively traverse the workspace.

## Verification

1. Workspace behavior tests resolve regular files/directories, reject traversal/symlinks, delete an
   ordinary file, reject a swapped/replaced file, and prove no file body is read.
2. Clipboard service tests pin platform commands, target/path/name projection, helper timeout/output
   limits, and error mapping without launching a real OS paste operation.
3. Main/Shell source contract tests pin file/directory menu ordering/IDs, focused-item shortcuts,
   no input/editor interception, destructive confirmation, cancel-first behavior, localized labels,
   selected-file cleanup, and no renderer-visible absolute-path/delete result.
4. `node --test tests/onlypreview/*.test.mjs`.
5. Node typecheck, renderer i18n check, focused error-level ESLint, `git diff --check`, and
   `yarn build`.
6. Electron/Playwright E2E is not run. Ral owns live acceptance: paste a copied file and folder in
   Finder/Explorer, verify all three text forms and shortcuts, cancel once, delete an unselected
   file, delete the selected file, and confirm tree/search/preview convergence.

## Verification Evidence

- Focused coordinator, Workspace, Clipboard, Main wiring, and Shell UI tests: **PASS — 40/40**.
- `node --test tests/onlypreview/*.test.mjs`: **PASS — 336/336**, with zero failed, cancelled,
  skipped, or todo tests.
- `yarn typecheck:node`, `yarn check:renderer-i18n`, focused error-level ESLint,
  `git diff --check`, and `yarn build`: **PASS**.
- [Independent review 1](../reviews/onlypreview-permanent-delete-029-1.md) and
  [review 2](../reviews/onlypreview-permanent-delete-029-2.md) recorded two selection-generation
  races as **BLOCKED**; both were corrected.
  [Independent review 3](../reviews/onlypreview-permanent-delete-029-3.md) rechecked the complete
  contract and recorded **PASS** with no P0-P2 finding.
- Electron/Playwright E2E, the real app, and live clipboard/delete operations were intentionally
  not run. Ral owns the environment-dependent checks below.

## Owner Verification

- In Finder/Explorer, paste one copied file and one copied folder whose names include spaces,
  quotes, and non-ASCII characters. On Linux, confirm unsupported pasteable-item copy fails visibly
  instead of substituting a text path.
- Verify Copy Path, Copy Relative Path, Copy Name, `Cmd/Ctrl+C`, `Shift+Cmd/Ctrl+C`, and
  `Option/Alt+Cmd/Ctrl+C`. Confirm ordinary text copy remains native in the Project filter/search
  input, editor, and Preview content.
- Cancel one delete, force one delete failure, delete an unselected A while B is loading, delete a
  selected A and immediately select B, and delete selected A while A itself is still loading.
- Confirm successful Delete removes exactly one regular file directly from disk, does not put it in
  Trash/Recycle Bin, never offers directory deletion, and lets tree/search/Preview converge without
  losing the latest explicit selection.
