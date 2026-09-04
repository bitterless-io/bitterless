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

`locateCurrentFile` in `App.vue` clears the tree selection before locating, so the anchor collapses
onto `treeSelectedRelativePath` and `isSelected` answers for the located row.

- The clear is gated on the same precondition `locateSelectedFile` uses, so invoking locate with
  nothing previewed cannot wipe a real multi-selection.
- Done in `App.vue`, not the shell store: the controller already imports the shell store, and the
  reverse import would close a cycle the controller's own comments record fighting.
- Cmd-click and Shift-range behaviour is untouched.

## Acceptance

| Scenario | Expectation |
|---|---|
| Open from global search, then locate | Row is centred **and** highlighted |
| Open from the tree, then locate | Unchanged |
| Multi-select rows, then locate the previewed file | Collapses to the located row |
| Locate with nothing previewed | Existing selection untouched |
| Cmd click after locating | Moves the anchor without moving the preview, as before |

Regression: `tests/onlypreview/onlyPreviewTreeSelection.test.mjs` — "locating the previewed file
collapses the tree selection onto it". Verified to fail against the pre-fix `App.vue`.

Implementation task:
[onlypreview-locate-collapses-selection-126](../plan/tasks/onlypreview-locate-collapses-selection-126.md).
