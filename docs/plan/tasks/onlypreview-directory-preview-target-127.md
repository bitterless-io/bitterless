---
id: onlypreview-directory-preview-target-127
scope: let a directory reach the preview pane and render its name, path, and child entries
status: pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewDirectoryTarget.test.mjs && yarn typecheck:node && yarn check:renderer-i18n && git diff --check
---

# Preview a directory

## Objective

Selecting a directory — from the tree or from Global Search — shows that directory in the preview
pane instead of doing nothing.

## Context

- `docs/features/onlypreview-browse-history.md`
- `src/main/xpc/onlyPreview.handler.ts:261-295` (`selectStandaloneFile` and its file guard)
- `src/preload/onlypreview/search/core/global-search-preview.mjs:218` (existing directory listing)
- `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/DirectorySearchPreview.vue`

## Contract

- Add a directory selection path beside `selectStandaloneFile`. **Do not** loosen its
  `PATH_NOT_REGULAR_FILE` guard: everything downstream of a file selection — read broker, asset
  grants, Office sessions, Find — assumes a regular file.
- A directory presentation carries no `fileRef` authority: no broker grant, no asset URL, no Find
  coverage, no `selectedTextAvailable`.
- Reuse `OnlyPreviewDirectoryPreviewEntry` and the existing listing producer. Do not add a second
  way to enumerate a directory.
- The preview pane renders name, full relative path, the child entries, and a total count. The
  toolbar shows the directory name in place of a file name and hides the type badge and file
  actions.
- Selecting a directory must not change what Locate or the MCP `preview.open` contract consider the
  previewed file.
- Both languages get every new string; no hardcoded user-facing text.
- Bounded like every other listing: a directory with very many children is truncated with the total
  still reported.

## Verification

- Main refuses a directory through the file path and accepts it through the directory path.
- A directory presentation issues no broker grant and no asset URL.
- The preview renders name, path, entries, and count; an empty directory renders its empty state.
- Selecting a directory then a file leaves the file authority intact.
- `yarn check:renderer-i18n` passes.
- Do not run Electron, Playwright, or packaging.
