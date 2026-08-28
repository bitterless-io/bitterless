# OnlyPreview Project tree does not distinguish Search-excluded paths

Status: implemented; owner verification pending

## Problem

The Project tree intentionally keeps complete demand-loaded directory listings even when a path is
excluded from Global Search. Excluded directories, their excluded descendants, and directly
excluded files currently look identical to searchable paths, so the user cannot tell why a visible
item never appears in Files or Contents results.

## Accepted Correction

```text
Project tree

  src                         normal row / normal folder icon
  node_modules               pale-orange row / solid accent-orange folder icon
    package                  pale-orange row / solid accent-orange folder icon
      index.js               pale-orange row / normal file icon
  generated                  pale-orange row / solid accent-orange folder icon
    keep                     normal when an ordered ! rule re-includes it
```

- Every visible file or directory that is currently excluded by the exact Global Search traversal
  policy receives a pale-orange row background.
- An excluded directory uses the solid Bitterless accent orange `#C2410C` for both closed and open
  folder icons. Excluded file icons retain the normal file glyph; the row background carries their
  status.
- A child below a physically pruned hidden, fixed-exclusion, or configured-exclusion directory
  inherits the marker through its opaque directory capability, including when a configured rule
  matches only the directory name. Ordered `!` re-inclusions remain truthful: an excluded directory
  that must still be traversed for a later re-inclusion does not blindly mark that re-included
  descendant.
- Hover and selected variants remain pale orange. Selection stays visible through the existing
  Royal Blue trailing rail and focus treatment.
- The synthetic workspace root is never marked. Symlinks keep their existing muted treatment.

## Data And Performance Contract

The hidden `fileSearch` preload computes one `searchExcluded` boolean while it already creates each
BrowseIndex entry. Each opaque directory token also retains one bounded ancestor-blocked boolean:
an excluded directory blocks descendants unless the ordered policy says it must remain traversable
for a later `!` re-inclusion. The preload therefore reuses the current in-memory traversal policy
without an extra `stat`, directory walk, body read, SQLite query, path-prefix scan, or Renderer-side
ancestor scan. The exact entry boolean crosses the existing capability-scoped browse-listing relay
and is validated at Main and Renderer boundaries.

Refresh/config replacement rebuilds the BrowseIndex with the current policy. Watch-driven refresh
of an already loaded listing republishes the same marker contract. Global Search metadata and
SQLite eligibility remain unchanged.

## Acceptance

- Directly excluded files and directories have a pale-orange Project-row background.
- Loaded files and directories beneath an excluded ancestor have the same background.
- Excluded open and closed directory icons use solid accent orange.
- Normal and explicitly re-included paths retain the existing Project colors.
- The marker is computed once per emitted browse entry without additional filesystem I/O.

## Resolution

Task [onlypreview-search-exclusion-markers-039](../plan/tasks/onlypreview-search-exclusion-markers-039.md)
implements this correction. The first independent review found and blocked an exact-directory
inheritance gap; the corrected opaque-capability propagation passed
[independent review 2](../plan/reviews/onlypreview-search-exclusion-markers-039-2.md). Live visual
acceptance remains with Ral.
