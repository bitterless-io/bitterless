# Locate file leaves the row unhighlighted after opening from global search

Status: implemented; owner verification pending

## Observed behavior

Ral 2026-09-04: open a file through global search, then click **locate file** in the Project list.
The tree scrolls to the row, but the row does not get the selected background.

## Root cause

The tree highlight comes from `OnlyPreviewTreeSelectionController.isSelected()`
(`onlyPreviewTreeSelection.store.ts:56-62`), bound in `App.vue:193-207`:

```ts
isSelected(relativePath: string): boolean {
  if (this.paths.includes(relativePath)) return true;
  return this.paths.length === 0 && this.anchor === relativePath;
}

private get anchor(): string | null {
  return this.anchorPath ?? this.host.treeSelectedRelativePath;
}
```

`treeSelectedRelativePath` is only the **fallback**. An explicit `anchorPath` — set by any earlier
click — outranks it, and a non-empty multi-selection (`paths`) skips the fallback entirely.

`locateSelectedFile()` (`onlyPreviewShell.store.ts:233-242`) moves `treeSelectedRelativePath` and
expands the parents, but never touches the controller. That is deliberate elsewhere: a Cmd click
moves the anchor without moving the tree highlight or the preview, and the two fields are documented
as intentionally separate. Locate, however, *is* a "make this the tree's row" gesture.

Opening from global search makes it visible every time: that path calls
`onlyPreviewClient.selectStandaloneFile(...)` from the global-search renderer
(`onlyPreviewGlobalSearchHost.client.ts:162`), so the previewed file was never clicked in the tree
and `anchorPath` still points at whatever was. With no prior click at all the fallback happens to
work, which is why this only shows up after a search.

## Fix

The rule is applied once, to **every** path that moves the anchor without a click, rather than only
to the reported gesture: `locateSelectedFile()` and `centerTreeRow()` both collapse the tree
selection before re-anchoring. `centerTreeRow` is the watch commit that inherited the selection onto
a new path and the explicit global-search directory reveal; both re-anchor deliberately and would
otherwise leave the same stale highlight.

The shell store holds a `collapseTreeSelection` callback that `onlyPreviewTreeSelection.store.ts`
assigns at module scope, because:

- the controller already imports the store, and the reverse import would close the cycle its own
  comments record fighting;
- the store is at an enforced **800-line budget** — the reason the controller is a separate module
  at all — so the explanation lives in the controller and the store keeps two lines;
- a no-op default means an unregistered controller degrades to the previous behaviour rather than
  throwing.

Locate collapses after its own `selectedRelativePath` guard, so locating nothing cannot wipe a real
selection. Cmd-click and Shift-range behaviour is untouched.

## Acceptance

| Scenario | Expectation |
|---|---|
| Open from global search, then locate | Row is centred **and** highlighted |
| Open from the tree, then locate | Unchanged |
| Multi-select rows, then locate the previewed file | Collapses to the located row |
| Locate with nothing previewed | Existing selection untouched |
| Watch commit inherits the selection onto a renamed path | Highlight follows to the new row |
| Global-search directory reveal | Revealed row is highlighted |
| Cmd click after locating | Moves the anchor without moving the preview, as before |

Regression: `tests/onlypreview/onlyPreviewTreeSelection.test.mjs` — "locating the previewed file
collapses the tree selection onto it". Verified to fail against the pre-fix `App.vue`.

Implementation task:
[onlypreview-locate-collapses-selection-126](../plan/tasks/onlypreview-locate-collapses-selection-126.md).
