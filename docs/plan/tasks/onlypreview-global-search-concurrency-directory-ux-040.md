---
id: onlypreview-global-search-concurrency-directory-ux-040
scope: Global Search concurrency, folder ordering, and live Project directory interaction
status: implemented; owner verification pending
depends-on: [onlypreview-search-exclusion-markers-039]
verify: node --test tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs && yarn typecheck:node && yarn typecheck:web && yarn build && git diff --check
---

# Run grouped search together and keep Project directory context live

## Objective

Run authoritative Files and Contents work cooperatively in one latest-only request, stable-partition
Files folders before files, synchronize explicit Project directory selection while Global Search is
open, make nested directory-result reveal visibly expand and focus its target, and render the
directory display type as `folder`.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-global-search-concurrency-and-directory-ux.md`
- `docs/issues/onlypreview-directory-selection-and-global-file-scope.md`

## Path

- `src/preload/onlypreview/search/core/global-search-executor.mjs`
- `src/preload/onlypreview/search/core/global-search-files.mjs`
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchResult.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchTree.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/components/GlobalSearch/SearchResultRow.vue`
- `tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/issues/onlypreview-global-search-concurrency-and-directory-ux.md`
- `docs/issues/onlypreview-directory-selection-and-global-file-scope.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Preserve priority-lane and first-build readiness ordering. After those gates, start Files metadata
  and Contents SQLite work without awaiting either first. On error/cancellation, signal the sibling
  branch and await both branches before releasing `activeQueryCount` or index ownership.
- Stable-partition matching Files entries into directories then files before issuing result tokens
  or applying the section cap. Preserve existing order within each partition, report truncation
  against all matches, and keep temporary authorities bounded.
- Add one active-only directory-scope synchronization path. A changed derived Current directory
  updates path/label; only Current-directory Contents with a non-empty query is cancelled and
  rescheduled. Project-scoped Contents performs no redundant search. Focus-only movement and result
  selection remain inert.
- Directory-result reveal expands root, all ancestors, and the target; loads target direct children;
  selects the target; and requests centered Project focus after Global Search exits. Reveal failure
  leaves search and its accepted results active.
- Derive the visible `folder` type from the result `nodeKind` in Renderer code. Do not change
  `OnlyPreviewSearchMediaType`, directory `mediaType: unknown`, XPC payload shapes, or preview
  authority.
- Preserve one-active/one-latest cancellation, 250-per-section and 500-total capability limits,
  terminal token replacement, preview fencing, first-build early Contents behavior, and Main's
  no-filesystem-I/O boundary.

## Verification

- Runtime tests prove both authoritative branches start, terminal response waits for both, failure
  drains the sibling before active ownership is released, and existing cancellation/token behavior
  survives.
- Files tests cover mixed traversal order, stable folder/file partitions, directory-saturated caps,
  file-filled caps, and truthful truncation.
- Renderer tests replace the frozen-anchor expectation with live explicit selection, cancellation
  and re-dispatch under Current directory, no redundant Project-scope dispatch, and latest-anchor
  use after switching back.
- Reveal tests cover nested ancestors, target expansion/direct-child load, selected/focused state,
  centered DOM focus, and failure retaining Global Search.
- UI tests prove directories display `folder` while files retain their media type.
- Run the listed focused tests, applicable typechecks, build, and `git diff --check`. Do not run
  Electron, Playwright, E2E, or the real application; Ral owns live visual/keyboard verification.

## Owner Verification

- Search a term matching folders, filenames, and bodies in a large project. Confirm Files and
  Contents begin filling without waiting for each other, every folder precedes every file, and the
  interface remains responsive.
- Keep Current directory selected in the Contents selector, click several Project directories, and
  confirm the label and Contents results follow each latest explicit selection. Repeat while the
  selector is Project and confirm it does not visibly rerun an equivalent query.
- Double-click a deeply nested folder result. Confirm Global Search closes only after the Project
  tree exposes, expands, centers, focuses, and selects that exact folder.
- Confirm folder result rows say `folder`, not `unknown`.

## Delivery

- Implemented cooperative authoritative Files/Contents branches under one retained index lease;
  cancellation or branch failure drains both siblings before releasing active ownership.
- Implemented one-pass bounded folder-first Files partitioning, live explicit Current-directory
  synchronization, full nested directory reveal/select/center focus, and Renderer-only `folder`
  presentation.
- Focused task tests passed 46/46. `yarn typecheck:node`, directed Renderer type checking,
  `yarn build`, and `git diff --check` passed. Full `yarn typecheck:web` still reports only existing
  unrelated Poker, Home, Connector, Maestro, Omni, and `pathHelper` errors.
- [Independent review 1](../reviews/onlypreview-global-search-concurrency-directory-ux-040-1.md)
  passed with no P1/P2/P3 finding.
- Electron, Playwright, E2E, packaged smoke, and the real application were intentionally not run;
  live interaction verification remains with Ral.
