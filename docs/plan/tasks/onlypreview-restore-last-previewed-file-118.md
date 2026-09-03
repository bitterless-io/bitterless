---
id: onlypreview-restore-last-previewed-file-118
scope: remember the previewed file per Project directory and reopen it on the next launch
status: implemented; owner verification pending
depends-on: []
---

# Restore the Last Previewed File

## Objective

A relaunch reopens the file the Project was last previewing.

Feature: [`onlypreview-restore-last-previewed-file.md`](../../features/onlypreview-restore-last-previewed-file.md).

## Required behavior

1. `parseOnlyPreviewRecentFile` accepts only `{ version: 1, directoryPath, relativePath }` with an
   absolute, NUL-free directory and a non-empty, NUL-free relative path, and refuses any record with
   a different key count.
2. `rememberSelectedFile(directoryPath, relativePath)` writes the `last_file` sub-key on the
   existing serialized write chain. Called from `selectStandaloneFile` only after the present
   succeeded and the selection is still current.
3. `restoreFromStorage` attaches the remembered path to the returned workspace only when the stored
   directory equals the restored `displayPath`, and re-checks the restore fence afterwards.
4. `configureTargetRuntime` takes an optional `presentSelection`; `restoreFromStorage` awaits it
   best-effort. A rejection leaves the Project open with nothing previewed.
5. `presentOnlyPreviewRestoredSelection` re-authorizes the path, refuses a non-file with
   `PATH_NOT_REGULAR_FILE`, then selects and presents through the existing Main paths.
6. Records carry no capability token; the stored value is a directory and a relative path only.

## Verification

- `onlyPreviewRecentDirectory.test.mjs` covers the codec: the valid record, a missing directory or
  relative path, a wrong version, an empty relative path, a relative directory, embedded NULs, and
  an extra key.
- The existing recent-directory lifecycle tests pass unchanged (15 tests).
- `yarn build`, `tsc --noEmit -p tsconfig.node.json` and `vue-tsc --noEmit` are clean for OnlyPreview.
- Electron E2E excluded. The owner verifies by previewing a file, quitting, and relaunching.
