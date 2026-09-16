# Created Project entries wait for indexing; file copy/paste fails

Status: code implemented; packaged-app acceptance pending.

## Cause

New Folder successfully completed `mkdir` and broadcast its new-entry event. The renderer then
awaited `refreshIndex()` before selecting the row, without refreshing the parent directory's
BrowseProjection cache. Search refresh is queued with background reconciliation and can reuse an
already active build. The normal directory loader returns a cached listing. This made a completed
filesystem mutation depend on the search/watch lifecycle before becoming visible.

The observed project had about 95,355 search entries and several 34–40 second reconciliation scans.
The logs establish that the folder already existed while indexing continued; they do not measure
its exact creation-to-visible latency. Refresh acknowledges its first snapshot, so the defect is
queue coupling and stale browse data, not a claim that every refresh awaits a complete rebuild.

macOS file copy separately failed at runtime: AppleScript interpreted `set items to {}` as assigning
to `every item` and returned -10006. The script compiled successfully, so compilation alone missed
this failure. OnlyPreview also lacked a Project Cmd+V handler.

## Behavior after the change

- Completed creation/paste forces a direct, capability-checked parent listing. It bypasses cached
  directory reads and does not await search refresh. Consecutive creates and late responses are
  fenced; a workspace change cannot display old results in the new Project.
- Recent verified listings feed file/directory-name search before metadata/build/promotion waits.
  Terminal results merge the same listings, so completion of an older index cannot hide new names.
  Search exclusions, depth limits, symlink boundaries and workspace reset still apply. File content
  indexing continues independently in the background.
- Watch events have a separate, coalesced 50 ms metadata notification, keeping visible directories
  and their searchable names current while content reconciliation is busy.
- macOS copies native file URLs using AppKit. Cmd+C uses the complete tree selection. Cmd+V reads
  the OS file clipboard in Main, then copies in the private file authority process to the selected
  directory (or the selected file's parent). The Project root is supported. A same-name conflict
  aborts before copying; existing entries are never overwritten. Workspace/parent identity changes
  stop copying, and only newly created roots are eligible for rollback.

Both Bitterless and COWORK receive the shared implementation; host-specific integrations remain.

## Verification and human acceptance

New regression suites: `onlyPreviewProjectPasteFlow.test.mjs` (16 cases) and
`onlyPreviewRecentEntrySearch.test.mjs` (4 cases). Clipboard tests (9 cases) include real JXA
write/read checks against a private pasteboard, without modifying the user's clipboard. Existing
selection, browse, authority, search, watch and selected-file priority tests were also exercised.
Focused strict TypeScript and lint on the changed code pass (JavaScript lint disables the
TypeScript-only return-annotation rule). Broader checks retain an existing unused variable in the
search engine and unrelated existing
`O_CLOEXEC`, error-union and environment/path-helper type errors; the existing Shell 800-line
budget guard also still fails. No Electron/E2E, application launch, package build, install or release.

On builds containing this change, test BL Preview and COWORK:

1. While a large workspace indexes, create `V1`, then another folder immediately. Both rows should
   appear without waiting for indexing. Search each new name immediately; it must already appear
   and remain after the old index finishes.
2. Select one file, one folder and then several items; Cmd+C, click another directory, Cmd+V.
   Verify all contents, names with spaces/Unicode and the resulting rows/search matches. Also paste
   at the Project root and try a same-name conflict to confirm the original survives.
3. Create a file externally in an expanded folder while indexing. Its row and filename-search match
   should update promptly. Change workspace during an operation and check that old rows do not
   enter the newly selected Project.
