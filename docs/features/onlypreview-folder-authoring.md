# OnlyPreview Folder Authoring

Status: implemented; owner verification pending

Project-tree folder creation and in-place renaming for the OnlyPreview Project rail. This is the
first OnlyPreview capability that *adds* a filesystem entry; permanent delete
(`onlypreview-permanent-delete-029`) remains the only one that removes an entry.

## Scope

| Action | Entry point | Target |
| --- | --- | --- |
| New Folder | folder row context menu | inside the right-clicked folder |
| New Folder | Project root context menu | the workspace root |
| Rename | folder **and** file row context menu | the right-clicked entry |

New Folder is deliberately absent from the **file** row menu (owner decision 2026-09-02): creating
"inside" a file has no meaning, and the folder plus root menus already cover every location. The
root menu carries it because the root is a folder and excluding it would leave no way to create a
top-level directory.

Rename covers files as well as folders (owner decision 2026-09-02), so the tree does not offer an
action that silently applies to half its rows.

## Flow

```text
New Folder
  menu ─► Main allocates the next free untitled name ─► preload mkdir
       ─► tree row appears in edit mode with the name selected

Rename
  menu ─► renderer puts the row in edit mode with the current name selected
       ─► Enter or blur ─► Main renames through the preload
       ─► success: row keeps the new name · failure: row reverts to the previous name
```

Both mutations are performed by the hidden `fileSearch` preload, which is the only OnlyPreview
process allowed to touch the filesystem. Main stays a pure in-memory capability/revision authority
(`onlypreview-main-filesystem-io`), validates the response shape, and owns the native dialogs.

## Untitled name sequencing

The first folder created in a directory is `untitled folder`. When that name is taken the next free
name in the sequence `untitled folder 2`, `untitled folder 3`, … is used. Probing stops at
`ONLY_PREVIEW_UNTITLED_FOLDER_MAX_INDEX`; exhausting it is a typed failure, not an unbounded loop.

Sequencing is decided by the preload, inside the same authorized directory handle it creates in, so
the chosen name cannot be invalidated by a concurrent create between the check and the `mkdir`. An
`EEXIST` from `mkdir` advances to the next candidate rather than failing.

## Name rules

A typed name is trimmed of leading and trailing whitespace, then validated against the **union** of
Windows and macOS restrictions, on every platform. A folder created on macOS therefore stays valid
if the same tree is opened on Windows.

| Rejected | Reason |
| --- | --- |
| empty after trimming | no name |
| `.` and `..` | relative path components |
| `< > : " / \ | ? *` | Windows reserved characters; `/` and `:` also matter on macOS |
| U+0000–U+001F, U+007F | control characters |
| trailing `.` | Windows silently strips it |
| `CON` `PRN` `AUX` `NUL` `COM1`–`COM9` `LPT1`–`LPT9` | Windows reserved device names, case-insensitive, with or without an extension |
| > 255 UTF-16 code units, or > 255 UTF-8 bytes | per-component limit on NTFS and APFS respectively |

Validation runs in the renderer for immediate feedback **and** again in the preload before the
syscall. The renderer check is a convenience; the preload check is the contract.

## Editing behavior

- The row renders an input in place of its label, with the name pre-selected.
- The input width tracks the typed content, measured through a hidden mirror span that inherits the
  row's typography, so it is neither padded nor clipped for proportional fonts.
- **Enter** or **blur** commits. **Escape** cancels and restores the previous name without a
  syscall.
- A commit whose name is unchanged is a no-op, not a rename.
- A rejected name and a failed rename both restore the previous name. The row never keeps a value
  that is not on disk.
- A duplicate name raises a native Main dialog naming the collision; the row then reverts.
- While a row is in edit mode, tree keyboard navigation, selection, and double-click activation are
  suppressed for that row so typing cannot move the focus.

## Refresh

The existing project watcher republishes the browse listing when the directory changes, so a created
or renamed entry reaches the tree through the same path as any external filesystem change. The
mutation additionally nudges the listing so the row appears without waiting for watch latency.

Renaming the file that is currently previewed re-points the preview to the new relative path.
Renaming a folder that contains the previewed file clears the preview for that workspace, matching
the delete contract, because every capability is bound to the old relative path.

## Verification boundary

Automated coverage spans name validation on both platform rule sets, untitled sequencing including
`EEXIST` advancement and exhaustion, containment and symlink refusal, generation fencing, the
duplicate-name dialog and revert, edit-mode input sizing and key handling, and preview re-pointing.
Electron E2E is excluded; the owner verifies the real tree.
