# OnlyPreview Project selection is too muted

Status: implemented; owner verification pending

## Problem

The Project tree currently paints a selected file or directory with `#e3e6f1`. Against the
`#f9fafc` Project surface and the `#eff1f7` hover state, that treatment reads as grey and does not
make the current directory/file sufficiently obvious.

## Accepted correction

```text
default                         selected
transparent                    clear light blue #d6e4ff
     \                              + Royal trailing rail
      +-- hover #eff1f7

search-excluded selected       pale orange #f9dfc2
                               + Royal trailing rail
```

- Use the same brighter light-blue selected surface for ordinary files and directories. Selection
  remains driven by the existing `treeSelectedRelativePath` and `aria-selected` contract.
- The selected surface wins over ordinary hover through an explicit selected-hover rule. This also
  fixes the current specificity bug where `.onlypreview-shell__tree-row:hover` overrides the
  selected background while the pointer crosses the current row.
- Preserve the existing Royal Blue trailing rail, selected text color, keyboard focus outline,
  icons, typography, row geometry, and pointer/keyboard behavior.
- Preserve Search-excluded meaning: an excluded selected row stays pale orange and its excluded
  directory icon stays accent orange; the Royal trailing rail continues to show selection.

## Acceptance

- An ordinary selected file or directory is visibly bluer than the previous `#e3e6f1` treatment
  and remains selected-looking under hover.
- Ordinary hover, Search-excluded default/hover/selected colors, and focus-visible treatment do not
  regress.
- The change adds no renderer state, animation, layout work, filesystem I/O, or Electron process.

## Resolution

[Task 091](../plan/tasks/onlypreview-project-selection-blue-091.md) applies the clearer `#d6e4ff`
surface to the shared ordinary selected row and adds an explicit selected-hover rule. Search-excluded
orange remains authoritative, and [independent review 1](../plan/reviews/onlypreview-project-selection-blue-091-1.md)
passed after its initial cascade-test finding was corrected. Ral's live visual check remains.
