---
id: onlypreview-index-placeholder-retires-122
scope: stop the Project index placeholder from outranking the empty pane once a Project has resolved a file
status: implemented; owner verification pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewRenderingAdapters.test.mjs tests/onlypreview/onlyPreviewProjectIndexState.test.mjs && yarn typecheck:node && git diff --check
---

# Retire the Project index placeholder once the Project is proven browsable

## Objective

Deleting the selected file must land the preview pane on `Select a file`, not on
`Loading project`, without weakening the first-build case the placeholder exists for.

## Context

- `docs/issues/onlypreview-preview-stuck-loading-after-delete.md`
- `src/main/onlypreview/onlyPreviewProjectIndexState.service.ts` (the `ready` latch)
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue:174-203`

## Path

- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/main/onlypreview/onlyPreviewProjectIndexState.service.ts`
- `src/main/onlypreview/onlyPreviewOpenDiagnostics.runtime.ts`
- `src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts`
- `tests/onlypreview/onlyPreviewRenderingAdapters.test.mjs`
- `tests/onlypreview/onlyPreviewProjectIndexState.test.mjs`
- issue and index documents

## Contract

- Record the workspace of any presentation that carries both a `fileRef` and a `descriptor`. That is
  Main's own proof the Project resolved a real file; record it on every surface, not only `vue`.
- `projectIndexing` returns false for that workspace regardless of `projectIndexState`, so the empty
  pane renders `Select a file`.
- A workspace that has proven nothing keeps the placeholder, including a second Project bound later
  in the same session. `ready` / `failed` / no-Project behavior is unchanged.
- Do not change the `ready` latch, the delete path, the `loading` flag, or the order of branches in
  `PreviewSurface.vue`.
- Record every index-state transition, including `cleared`, without giving
  `OnlyPreviewProjectIndexStateService` a dependency on the Electron log runtime — pure-Node tests
  bundle that file with only `electron-xpc/main` stubbed. Inject the sink and default it to a no-op
  so a missed wiring degrades to today's silence, never to a crash.
- Keep `followDeletedSelection` non-fatal, and make its failure leave a record naming the workspace,
  node kind and reason.
- Do not modify unrelated dirty-worktree changes.

## Verification

- Regression proving the reported sequence: a `building` Project resolves a file, then receives the
  empty presentation `clearPresentation` publishes on delete → `projectIndexing` false, rendered
  markup is `onlypreview__previewEmpty` and not `onlypreview__previewIndexing`.
- Same test proves an unproven workspace still renders the placeholder.
- The regression must fail against the pre-fix store — verified by reverting the store and re-running.
- Do not run Electron, Playwright, packaging, signing, or publication.

## Delivery

- Added `browsedWorkspaceId` to the preview store, set in `applyPresentation` when the presentation
  carries a workspace, a `fileRef` and a `descriptor`.
- `projectIndexing` now returns false for that workspace; every other input is unchanged.
- Extended the existing index-state coverage with the delete sequence and the unproven-Project case.
- `OnlyPreviewProjectIndexStateService` gained an injected `setTrace` sink and emits
  `event=project-index workspaceId=… from=… to=…` from `publish()` and `clear()`. Wired to the open
  diagnostics in `onlyPreviewOpenDiagnostics.runtime.ts`, which keeps the service bundleable.
- `followDeletedSelection` keeps its swallow but emits `event=delete-follow-selection-failed` with
  the workspace, node kind and reason.

## Verification result

- `node --test` on the rendering-adapter and index-state suites — 17/17.
- Reverting only the store to HEAD makes the new placeholder regression fail (9/10) and restoring it
  passes again, so that regression is not vacuous.
- Every suite that reads the changed Main sources as text — delete dialog, app wiring, tree
  selection, filesystem boundary, project root, project mutation refresh — 67/67 together with the
  rendering adapters.
- `yarn typecheck:node` — 0 errors.
- ESLint on all changed files — 0 findings. The rendering-adapter suite gained the
  `explicit-function-return-type` disable header its sibling `.mjs` suites already carry, which also
  cleared one pre-existing error in that file.
- `git diff --check` passed.
- `yarn typecheck:web` reports 80 errors on this branch, none in the touched files — pre-existing
  in-flight work under `maestro/`, `omni/`, `onlyPreviewTreeSelection.store.ts` and `pathHelper/`.
- No Electron, Playwright, packaging, signing, or publication ran.

## Owner Verification

- Select a file in a Project, delete it, and confirm the pane reads `Select a file`.
- Open a fresh large Project and confirm `Loading project` still appears before the first selection.
- With the next package, `grep project-index ~/Library/Logs/<product>/onlypreview/onlypreview.log`
  answers whether that Project's index ever reaches `ready` — the question this issue could not
  answer from the record.
