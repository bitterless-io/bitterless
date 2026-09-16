---
id: onlypreview-files-section-scope-178
scope: Fence the Global Search Files section with the same scope as Contents, and make the scan cheaper rather than more expensive under it
status: implemented; owner verification pending
depends-on: [onlypreview-directory-selection-search-scope-038, onlypreview-global-search-query-scope-fencing-047]
verify: node --test tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewColdMetadataSearch.test.mjs tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShadow.test.mjs tests/onlypreview/onlyPreviewWarmSearchLifecycle.test.mjs; no Electron/Playwright/E2E
---

# One scope for both Global Search sections

## Objective

Owner, 2026-09-16: 「files 的部分也要受到 Contents scope 的限制，优化代码，保证性能，更新全局搜索
方案文档」.

Files was the one project-wide lookup while Contents followed the selected directory, so the same
query answered questions about two different subtrees at once. One scope now fences both. This
reverses the Files half of
[onlypreview-directory-selection-and-global-file-scope](../../issues/onlypreview-directory-selection-and-global-file-scope.md);
the tree-selection half of that decision is untouched.

## Required behavior

1. All four sites that produced Files rows pass the validated scope instead of a hardcoded
   `{ kind: 'project' }`: the warm/committed branch, the browse-index first-paint branch, the cold
   metadata-snapshot branch, and the selected-file priority lane.
2. The priority lane tests the scope **before** the name match, so an out-of-scope selected file is
   never streamed into Files and then taken away when the authoritative branch replaces the row.
3. A directory scope covers strict descendants only. The scope directory's own row is not a hit, and
   a sibling that merely shares the name as a string prefix (`one-archive` under scope `one`) is not
   swept in - the trailing slash in the containment test is what guarantees that.
4. The root row (`relativePath: ''`) and Project scope both still mean the whole workspace.
5. The selector is relabelled in both catalogs and both repos: it no longer governs only Contents.
6. Performance must not regress at Project scope and must improve under a directory scope.

## Path

- `src/preload/onlypreview/search/core/global-search-executor.mjs` - three call sites
- `src/preload/onlypreview/search/core/selected-file-priority-lane.mjs` - the fourth
- `src/preload/onlypreview/search/core/global-search-files.mjs` - scope resolved once per query
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts` - both catalogs
- `src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less` - the ring
- `docs/design/onlypreview-global-search.md`, the reversed issue, task 071, `docs/INDEX.md`
- the same `.mjs` and `.less` mirrored byte-identically into `micromeet-cowork`

## Performance

The Files pass is linear in workspace size, not in the query (~200ms at 130,000 entries), and the
scope is what bounds it. The per-entry guard is node-kind, then containment, then the Unicode
normalization; the normalizer is the expensive step, so rejecting on the cheap containment test
first makes a narrow scope strictly cheaper. Two further edits keep Project scope from paying for
the new fence: the `dir/` prefix is built once per query rather than per entry, and Project scope
resolves to `null` so the loop skips the containment call entirely instead of re-deciding the same
branch for every entry.

Measured on 130,000 synthetic entries with 1% of them under the scope, min of five runs:

| | before | after |
| --- | --- | --- |
| Project scope | 187.0ms | 185.6ms |
| Directory scope | 182.3ms (the scope was ignored) | **27.6ms** |

So 6.6x at that shape and no regression at Project scope. The win is proportional to what the scope
excludes, not a fixed factor: a scope holding most of the tree saves almost nothing.

The cooperative yield cadence is deliberately untouched: it is load-bearing for
`onlyPreviewGlobalSearchEngine.test.mjs`'s sibling-drain test. A binary-searched range slice over
the sorted tree order was considered and rejected - all three call sites feed a lazy generator that
merges the browse index over `treeEntries`, so there is no sorted array at the point of the walk. Answering the section from the index
rather than the scan stays [task 071](onlypreview-files-section-sql-lookup-071.md).

## What the owner gives up

A project-level name such as `network` no longer appears in Files while the scope is a directory
that does not contain it. The selector switches both sections to Project in one action, and that is
the way back.

## Verification

- `onlyPreviewGlobalSearchEngine.test.mjs` - both sections obey the scope; the `one-archive` sibling
  proves containment is per segment; Project scope still reaches every name; the priority lane no
  longer streams an out-of-scope file.
- `onlyPreviewColdMetadataSearch.test.mjs` - the cold snapshot is fenced too, and nothing under
  `areas/` streams under a `current` scope.
- `onlyPreviewSearchEngine.scope.test.mjs` - a hidden directory stays a valid scope that projects
  nothing in **both** sections.
- `onlyPreviewGlobalSearchShadow.test.mjs` - the shadow is a ring; its reach parser is rewritten to
  read all four lengths positionally instead of assuming the first `px` token is the y offset.
- Baseline: `onlyPreviewWarmSearchLifecycle.test.mjs` has 3 failures at HEAD that are not this
  change's; it must still have exactly those 3.
