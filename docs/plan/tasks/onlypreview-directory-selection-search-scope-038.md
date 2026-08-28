---
id: onlypreview-directory-selection-search-scope-038
scope: Project tree current-directory selection and split Global Search scopes
status: implemented; owner verification pending
depends-on: [onlypreview-global-search-workspace-037]
verify: node --test tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs tests/onlypreview/onlyPreviewSearchShell.test.mjs && yarn typecheck:node && yarn typecheck:web && yarn check:renderer-i18n && yarn build && git diff --check
---

# Select a Current directory and keep filename search project-wide

## Objective

Give Project directories an explicit Shell-owned selected/current-directory state: one click
selects without toggling and double click selects plus toggles expansion. Make Global Search Files
always search project-wide file/directory metadata while Contents alone defaults to that captured
Current directory and may switch to Project.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-directory-selection-and-global-file-scope.md`

## Path

- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/preload/onlypreview/search/core/global-search-executor.mjs`
- `src/preload/onlypreview/search/core/search-engine.mjs`
- `src/preload/onlypreview/search/core/selected-file-priority-lane.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- `tests/onlypreview/onlyPreviewAppWiring.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-directory-selection-and-global-file-scope.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Keep `selectedRelativePath` exclusively for the Main-owned current Preview file. Add a separate
  reactive tree selection whose derived Current directory is the selected directory itself, a
  selected file's parent, or root.
- A pointer single click selects/focuses a directory but never changes expansion. A pointer double
  click keeps it selected and toggles expansion. File single/double-click behavior keeps the
  existing setting contract. Keyboard activation remains accessible and updates the same tree
  selection before file activation or directory expansion.
- Project rows use the separate tree selection for the existing Royal selected treatment and
  `aria-selected`. Workspace replacement resets it; restored/external file selection, Locate,
  selecting a file, and revealing a directory synchronize it without persisting a directory path.
- Global Search captures the derived Current directory once on entry. Moving roving focus alone
  cannot silently change the captured anchor.
- The request scope controls Contents only. Files always scans the existing project-wide,
  time-sliced `treeEntries` metadata and includes eligible files plus directories. Directory names
  do not enter SQLite/FTS and never cause file-body reads.
- Split the selected-file priority lane the same way: filename matches are project-wide, content
  matches use the request scope. During first build, scoped Contents may stream early, but the
  authoritative Files terminal result waits for the existing complete candidate metadata; do not
  start a duplicate whole-project traversal.
- Preserve one-active/one-latest cancellation, 250-per-section caps, token replacement, exclusion,
  containment, memory bounds, and Shell/store source-size limits.
- Keep the persistent file-search database as completely unencrypted native `node:sqlite`. Do not
  add SQLCipher, a key pragma, Keychain/Core database credentials, or an encryption wrapper.

## Verification

- Renderer/source tests cover directory single-click selection without toggle, double-click
  selection plus expansion toggle, independent Preview selection, ARIA/class binding, explicit
  Current directory capture, workspace reset, and no focus-only scope drift.
- Runtime tests prove a directory such as `areas/network` outside Current directory still appears
  in Files, while Contents stays fenced until the selector switches to Project. Cover the
  selected-file priority path and first-build authoritative replacement.
- Run the listed focused tests, applicable typechecks, i18n, build, and `git diff --check`.
- Do not run Electron/Playwright/E2E/real application. Ral owns live pointer, keyboard, search, and
  large-project verification.

## Owner Verification

- Single-click a directory and confirm it becomes selected without changing expansion; double-click
  it and confirm it remains selected while expansion toggles. Verify Space/Enter on the focused
  directory follows the same selected/current-directory state.
- With a nested directory selected, open Global Search and search `network`: Files must find matching
  file and directory names anywhere in the project, while Contents initially stays inside Current
  directory and expands only after switching Contents scope to Project.
- Repeat during a first index build and a later reconcile on a large project. Search must remain
  responsive, never show a terminal false-empty Files result, and must not start a duplicate full
  project traversal.

## Delivery

- Added independent Project-tree selection state without overloading the Main-owned Preview file
  selection. Directory single click now selects only; double click and keyboard activation select
  before toggling expansion. The selected row supplies the captured Current directory for Contents.
- Split Global Search scope ownership: Files always searches the existing time-sliced project tree
  metadata, including directories, while Contents and selected-file content matches use the chosen
  Current directory or Project scope. Directory names remain outside SQLite/FTS.
- Made first-build/reusable-index readiness explicit and committed replacement SQLite plus sorted
  project metadata behind one promotion gate. Later readers wait behind an announced writer, so a
  build cannot close a queried index, starve on new queries, or expose replacement SQLite with stale
  empty Files metadata. The early scoped Contents traversal does not retain duplicate tree metadata.
- Kept the disposable file-search database completely unencrypted: it opens directly through native
  `node:sqlite` and receives no SQLCipher/key pragma, Keychain/Core credential, or encryption wrapper.
- [Independent review 3](../reviews/onlypreview-directory-selection-search-scope-038-3.md) records
  **PASS** with no remaining P1–P3 finding after the first two reviews' concurrency findings were
  fixed. The final focused run passes 30/30; `yarn typecheck:node`, `yarn build`, and
  `git diff --check` pass. Strict Web typecheck still reports only existing non-OnlyPreview Poker,
  Home, Connector, Maestro, Omni, and path-helper diagnostics. Renderer i18n still stops at the
  existing `Tray must follow Home creation` assertion. Electron/Playwright/E2E/real-app verification
  was intentionally not run; Ral owns the checklist above.
