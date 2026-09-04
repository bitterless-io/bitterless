---
id: onlypreview-locate-collapses-selection-126
scope: collapse the tree selection onto the anchored row for locate, inherited watch selection, and reveal
status: implemented; owner verification pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewTreeSelection.test.mjs && yarn typecheck:web && git diff --check
---

# Locate file highlights the row it locates

## Objective

Make **locate file** select the previewed row, so it gets the highlight background even when the
file was opened from global search and never clicked in the tree.

## Context

- `docs/issues/onlypreview-locate-file-leaves-no-highlight.md`
- `src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.store.ts` (anchor vs tree row)

## Path

- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.store.ts`
- `tests/onlypreview/onlyPreviewTreeSelection.test.mjs`
- issue and index documents

## Contract

- Every path that moves the tree anchor without a click collapses the tree selection onto that row:
  `locateSelectedFile()` and `centerTreeRow()` (inherited watch selection, explicit reveal).
- Locate collapses after its own `selectedRelativePath` guard, so locating nothing must not wipe a
  real multi-selection.
- The shell store must not import the selection controller — the controller imports the store, and
  the reverse would close a cycle its own comments record fighting. Register the collapse from the
  controller into a store-held callback with a no-op default.
- The shell store stays under its enforced 800-line budget; the explanation lives in the controller.
- Do not change Cmd-click anchor semantics, Shift-range resolution, or where New Folder lands.

## Verification

- Source assertions prove both anchor-moving methods collapse, that locate collapses only after its
  guard, that the controller registers the callback, and that the store does not import it.
- Assertions pin the two controller behaviours the fix depends on: `clear()` drops both `paths` and
  `anchorPath`, and `anchor` falls back to `treeSelectedRelativePath`.
- The existing budget assertion must still pass.
- The regression must fail against the pre-fix sources — verified by reverting both and re-running.
- Do not run Electron, Playwright, packaging, or publication.

## Delivery

- Added `collapseTreeSelection` to the shell store (two lines, no import) and called it from
  `locateSelectedFile()` and `centerTreeRow()`.
- Registered it from `onlyPreviewTreeSelection.store.ts`, where the reasoning is documented.
- An earlier draft did this in `App.vue`; it was moved into the store so the reveal and watch-commit
  paths, whose callers are internal to the store, are covered by the same rule.

## Verification result

- `node --test tests/onlypreview/onlyPreviewTreeSelection.test.mjs` — 20/20, budget assertion
  included; the store is 797 lines.
- Reverting both sources makes the new regression fail (19/20) and restoring them passes again.
- `yarn typecheck:web` — 80 errors, unchanged from the branch baseline and none introduced here. The
  one error inside `onlyPreviewTreeSelection.store.ts` is pre-existing and only shifted line number.
- `git diff --check` passed.
- No Electron, Playwright, packaging, or publication ran.

## Owner Verification

- Open a file from global search, click locate, and confirm the row is both centred and highlighted.
- Multi-select some rows, then locate, and confirm the selection collapses to the located row.
- Rename the previewed file outside the app and confirm the highlight follows to the new row.
