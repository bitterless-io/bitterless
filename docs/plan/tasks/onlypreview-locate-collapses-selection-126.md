---
id: onlypreview-locate-collapses-selection-126
scope: collapse the tree selection onto the located row so locate file highlights it after a global-search open
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

- `src/renderer/onlypreview/shell/src/App.vue`
- `tests/onlypreview/onlyPreviewTreeSelection.test.mjs`
- issue and index documents

## Contract

- Locate collapses the tree selection before moving the anchor, so `isSelected` answers for the
  located row through the `treeSelectedRelativePath` fallback.
- Gate the collapse on the same precondition `locateSelectedFile` uses; locating nothing must not
  wipe an existing multi-selection.
- Do it in `App.vue`, which already imports both. The shell store must not import the selection
  controller — the controller imports the store, and the reverse would close a cycle its own
  comments record fighting.
- Do not change Cmd-click anchor semantics, Shift-range resolution, `centerTreeRow`, or where New
  Folder lands.

## Verification

- Source assertions prove the collapse runs, that it is gated, and that it precedes the anchor move.
- Assertions pin the two controller behaviours the fix depends on: `clear()` drops both `paths` and
  `anchorPath`, and `anchor` falls back to `treeSelectedRelativePath`.
- The regression must fail against the pre-fix `App.vue` — verified by reverting it and re-running.
- Do not run Electron, Playwright, packaging, or publication.

## Delivery

- `locateCurrentFile` clears the tree selection when a file is previewed, then locates as before.
- Documented why the stale anchor outranked the tree row and why global search exposes it.

## Verification result

- `node --test tests/onlypreview/onlyPreviewTreeSelection.test.mjs` — 20/20.
- Reverting `App.vue` makes the new regression fail and restoring it passes again.
- `yarn typecheck:web` reports no error in `App.vue`; the branch's 80 pre-existing errors are
  unchanged and elsewhere. `git diff --check` passed.
- No Electron, Playwright, packaging, or publication ran.

## Owner Verification

- Open a file from global search, click locate, and confirm the row is both centred and highlighted.
- Multi-select some rows, then locate, and confirm the selection collapses to the located row.

## Not addressed

`centerTreeRow()` — used by watch commits and the global-search directory reveal — moves the same
anchor without collapsing the selection, so it can leave the same stale highlight. It was not part of
the reported gesture and changing it would alter what a watch-driven refresh does to a live
multi-selection, which deserves its own decision.
