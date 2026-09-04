---
id: onlypreview-observe-returned-index-snapshot-125
scope: observe the Project index snapshot that initialize and refresh return, so the index state can reach ready
status: implemented; owner verification pending
depends-on: [onlypreview-index-placeholder-retires-122]
verify: node --test tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs tests/onlypreview/onlyPreviewProjectIndexState.test.mjs && yarn typecheck:node && git diff --check
---

# Observe the returned Project index snapshot

## Objective

Let the Project index state reach `ready` when the index is already usable by the time `initialize`
answers, so the preview pane stops claiming "Loading project" over a fully rendered tree.

## Context

- `docs/issues/onlypreview-index-never-latches-ready.md`
- `docs/issues/onlypreview-preview-stuck-loading-after-delete.md` (the open question this answers)
- `src/main/onlypreview/onlyPreviewProjectIndexState.service.ts`

## Path

- `src/main/xpc/onlyPreviewSearchRuntime.handler.ts`
- `tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs`
- issue and index documents

## Contract

- `initialize` and `refresh` observe the snapshot they return, using that snapshot's own
  `workspaceId` and `state`.
- Observation is best effort: a failed result is passed through untouched, and a failure to resolve
  the host never turns a successful search call into an error.
- The broadcast observation path stays; a watch-driven snapshot never arrives as a return value.
- Do not change the `ready` latch, `markBound`, snapshot contents, timeouts, or any search contract.
- Keep the `browsedWorkspaceId` retirement from task 122 as defence in depth.

## Verification

- Source assertions prove both methods observe, that a failed result short-circuits, that the
  observation cannot throw out, and that the broadcast path is still wired.
- The regression must fail against the pre-fix handler — verified by reverting it and re-running.
- Do not run Electron, Playwright, packaging, or publication.

## Delivery

- Added `observeReturnedSnapshot()` and wrapped both `initialize` and `refresh`.
- Documented at the call site why the broadcast path alone was insufficient, with the issue link.

## Verification result

- `node --test tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` — 6/6.
- Reverting the handler makes the new regression fail and restoring it passes again.
- `yarn typecheck:node` — 0 errors. `git diff --check` passed.
- No Electron, Playwright, packaging, or publication ran.

## Owner Verification

- Open OnlyPreview on a Project that previously stuck on "Loading project" and confirm the pane
  reads `Select a file` once the tree has rendered.
- On a large Project, confirm `Loading project` still appears until the index is usable.
