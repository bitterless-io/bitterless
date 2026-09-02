---
id: onlypreview-folder-authoring-112
scope: New Folder and in-place Rename in the OnlyPreview Project tree, with union Win/macOS name rules and untitled sequencing
status: pending
depends-on: [onlypreview-permanent-delete-029, onlypreview-main-fs-boundary-audit-087, onlypreview-project-authority-preload-084]
---

# OnlyPreview Folder Authoring

## Objective

Give the Project rail the two authoring actions it lacks — create a folder and rename an entry —
without moving filesystem work into Main and without letting the tree display a name that is not on
disk.

Contract: [`features/onlypreview-folder-authoring.md`](../../features/onlypreview-folder-authoring.md).

## Required behavior

1. **Name rules** live in one shared module so the renderer and the preload cannot disagree:
   `validateOnlyPreviewEntryName(name)` returns `ok` or a typed reason for empty, dot, reserved
   character, control character, trailing dot, Windows device name, and both length bounds. It
   trims first and applies the union of Windows and macOS rules on every platform.
2. **Preload** gains `createDirectory` and `renameEntry` on the project authority. Both resolve the
   parent through the existing authorized workspace binding, refuse to leave containment, refuse a
   symlinked parent, re-validate the name, and fence on `workspaceGeneration`.
   `createDirectory` picks the next free `untitled folder` name itself, treats `EEXIST` as
   "advance to the next candidate", and fails typed at
   `ONLY_PREVIEW_UNTITLED_FOLDER_MAX_INDEX`. `renameEntry` fails typed and distinctly on `EEXIST`.
3. **Main** adds `createProjectDirectory` and `renameProjectEntry` to `fileSearchWindowService` with
   the same exact-key response validation the delete grant uses, plus
   `NAME_EXISTS` / `NAME_INVALID` error codes in the OnlyPreview contract.
4. **Menus** in `onlyPreviewProjectNativeAction.service.ts`: New Folder on a directory row menu and
   on the Project root menu, never on a file row menu; Rename on every row menu. A duplicate name
   raises a native `dialog.showMessageBox` naming the collision, consistent with the existing copy
   and delete failure dialogs.
5. **XPC**: two new named `runOperation` entries so the renderer can request a create and commit a
   rename. Both go through `onlyPreviewWorkspaceRegistry` authority resolution and stay inside the
   existing capability/revision fencing.
6. **Renderer**: `onlyPreviewShellStore` owns one `editingRelativePath` plus its draft, and the tree
   row renders an auto-sized input when it is the edited row. Enter and blur commit, Escape cancels,
   an unchanged name is a no-op, and every rejection restores the previous name. Tree keyboard
   navigation, click selection, and double-click activation are suppressed for the edited row.
7. **Preview continuity**: a successful rename of the previewed file re-points the preview to the
   new relative path; renaming an ancestor folder of the previewed file clears the preview for that
   workspace.
8. Delete, copy, reveal, search, indexing, and every existing preview result are unchanged.

## Layout

```text
┌──────────── Project ────────────┐      ┌──────────── Project ────────────┐
│ ▾ 📁 overmind                   │      │ ▾ 📁 overmind                   │
│    ▸ 📁 areas                   │      │    ▸ 📁 areas                   │
│    ▸ 📁 projects                │  ──► │    ▸ 📁 projects                │
│      📄 README.md               │      │      📄 README.md               │
│                                 │      │    ▾ 📁 [untitled folder    ]   │  ← input, width = content
└─────────────────────────────────┘      └─────────────────────────────────┘

Folder row menu            Project root menu          File row menu
  Preview (files only)       Reveal in folder            Preview
  ─────                      ─────                       ─────
  Reveal in folder           New Folder                  Open in system app
  New Folder                 ─────                       Reveal in folder
  Rename                     Copy Folder / Path / …      ─────
  ─────                                                  Copy File / Path / …
  Copy Folder / Path / …                                  ─────
                                                          Rename
                                                          ─────
                                                          Delete…
```

## Expected paths

- `docs/INDEX.md`
- `docs/features/onlypreview-folder-authoring.md`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`
- `src/shared/onlypreview/onlyPreviewEntryName.shared.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/shared/onlypreview/onlyPreviewFileAuthorityRuntime.types.ts`
- `src/preload/fileSearch/fileSearchProjectAuthority.service.ts`
- `src/preload/fileSearch/fileSearch.preload.ts`
- `src/main/fileSearch/fileSearchWindow.service.ts`
- `src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `tests/onlypreview/onlyPreviewEntryName.test.mjs`
- `tests/onlypreview/onlyPreviewFolderAuthoring.test.mjs`

## Verification

- Name coverage proves every rejection reason and that a valid name survives, including a name that
  is legal on macOS but reserved on Windows.
- Authority coverage proves untitled sequencing from the first free index, `EEXIST` advancement,
  exhaustion, containment and symlink refusal, generation fencing, and a distinct duplicate failure
  for rename.
- Store coverage proves Enter/blur commit, Escape cancel, unchanged no-op, revert on rejection and
  on duplicate, and suppressed navigation while editing.
- Source coverage proves New Folder is absent from the file row menu and present on the folder and
  root menus.
- `yarn typecheck:node` and `yarn typecheck:web` show no new error in the touched files.
- Electron E2E is excluded; the owner verifies the real tree.
