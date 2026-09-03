---
id: onlypreview-project-loading-state-119
scope: show a Loading project state in the empty preview pane while the Project index is still building
status: implemented; owner verification pending
depends-on: []
---

# Project Loading State

## Objective

The empty preview pane must say the Project is loading, with an animation, until its index is usable.

Feature: [`onlypreview-project-loading-state.md`](../../features/onlypreview-project-loading-state.md).

## Required behavior

1. `OnlyPreviewProjectIndexStateService` is the authority. `markBound` sets `building`; `markObserved`
   records an observed snapshot state but never leaves `ready`; `markFailed` is terminal until the
   next bind; `clear(workspaceId)` drops an abandoned bind. Every change re-publishes the preview
   presentation. A report for another workspace or host is ignored.
2. `onlyPreviewWorkspaceRegistry.onRevoke` clears the state, so a bind that succeeded and was then
   abandoned — superseded generation, non-canonical directory, revoked host — cannot leave `building`
   behind with no Project current.
3. `OnlyPreviewPreviewPresentation.projectIndexState` is derived in `snapshotInternal`, never read
   from the stored presentation: binding a Project clears the presentation right afterwards.
4. `reportProjectIndexFailed` is authority-checked in Main; the shell calls it from the one place
   both index entry points now share.
5. The pane renders `onlypreview__previewIndexing` when the empty state would render and the state is
   `building` or `reconciling`. `failed`, `ready` and `null` render the plain empty state.
6. The mark is unchanged between the two states, and the empty state reserves the rows' height.
   `prefers-reduced-motion` stops the sweep and leaves the rows half filled.

## Verification

- `onlyPreviewProjectIndexState.test.mjs`: bind, the ready latch against watch-driven churn, stale
  workspace and host rejection, abandoned-bind clearing, the failed terminal, and one republish per
  real change.
- `onlyPreviewRenderingAdapters.test.mjs`: the pane follows the state pulled with the presentation
  through `building → reconciling → ready → failed → null`, and renders the matching branch.
- `tests/onlypreview/*.test.mjs`: 660 tests, 654 pass. The 6 failures are pre-existing and belong to
  another session's in-flight work.
- `yarn build` succeeds; `tsc --noEmit -p tsconfig.node.json` and `vue-tsc --noEmit` report no error
  in any OnlyPreview file; `git diff --check` is clean.
- Electron E2E excluded. The owner verifies by opening a large folder and watching the pane.
