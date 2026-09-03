# OnlyPreview Restores the Last Previewed File

Status: implemented; owner verification pending

OnlyPreview already reopens the last Project directory. It now also reopens the file that Project
was last previewing, so a relaunch lands where the owner left off instead of on an empty preview.

Owner request, 2026-09-03: 「only preview 要能保存上次打开的文件，下次打开直接显示上次打开的」.

## Storage

A second sub-key beside the existing directory record, in the same setting:

| key | sub_key | value |
| --- | --- | --- |
| `onlypreview_workspace` | `last_directory` | `{ version: 1, directoryPath }` |
| `onlypreview_workspace` | `last_file` | `{ version: 1, directoryPath, relativePath }` |

A separate sub-key rather than a third field on the directory record: that record's shape is
validated exactly — two keys, version 1 — and widening it would require a migration for a value that
is only a convenience.

The directory is stored **inside** the file record. A remembered selection is applied only when the
restored Project is the same directory it was captured in, so opening a different folder can never
inherit another Project's selection.

## Write

`rememberSelectedFile` is called from `selectStandaloneFile`, after the preview has actually
presented and while the selection is still current — a superseded click never becomes the file the
next launch reopens. Writes are last-write-wins, deliberately: unlike the directory record, which
gates whether a Project is restored at all, a lost write here costs one click.

## Read

`restoreFromStorage` reads the record only on a true first restore — the path is unreachable once a
workspace is bound, so the repeated `restoreWorkspace` calls behind selection sync cannot re-present
anything. When the directory matches, the remembered path rides back on the workspace's existing
`selectedRelativePath` field, which is the same channel an explicitly opened file already uses.

Main then presents it through `presentOnlyPreviewRestoredSelection`, because attaching the preview
surface is Main's job and the renderer only learns the path. The remembered path is re-authorized
first: a path that has since been deleted, or replaced by a directory, is refused and the Project
opens with nothing previewed.

Delivery: [onlypreview-restore-last-previewed-file-118](../plan/tasks/onlypreview-restore-last-previewed-file-118.md).
