---
id: onlypreview-files-section-sql-lookup-071
scope: Answer the Global Search Files section from the index instead of rescanning every tree entry
status: unblocked and rescoped - the product decision landed as "no" (task 178) and task 043 is implemented; the SQL lookup itself is not started
depends-on: [onlypreview-indexing-plan-comparison-070, onlypreview-cold-folders-native-search-overlay-043]
verify: node --test tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs && node --test tests/indexing/indexingPipeline.test.mjs && node tests/indexing/bench/queryHotspots.bench.mjs --scale medium && node tests/indexing/bench/planMatrix.bench.mjs --plans A --scales medium --repeat 3 && yarn typecheck:node && yarn eslint --cache . && git diff --check
---

# Answer the Files section from the index

## Objective

Remove the per-query, whole-workspace, scope-blind rescan that answers the Global Search Files group,
without changing what it returns. Measured today at 1.5us per tree entry per query: about 200ms on a
130,000-entry workspace, and already the dominant per-query cost at 6,000 files.

## Evidence

`docs/issues/onlypreview-files-section-per-query-rescan.md` carries the full attribution. The two
numbers that select this task:

- The Files branch costs 199.73ms at 130,000 entries and 1.75ms at 1,000 - linear in workspace size,
  independent of the query.
- A directory scope changes it by nothing: 1.0x at every scope for the unique-needle query, 0.9x for a
  name query, measured on the 6,000-file corpus.

A benchmark plan answering the same section from SQL measures 3.45ms project-wide and 0.10ms at a
1%-of-text directory on that corpus, with full result parity against this engine.

## Context

- `docs/issues/onlypreview-files-section-per-query-rescan.md`
- `docs/issues/onlypreview-directory-selection-and-global-file-scope.md` - the product decision that
  made the section project-wide, and its 2026-09-16 reversal
- `docs/design/onlypreview-indexing-plan-evaluation.md`
- `docs/design/onlypreview-global-search.md`

## Path

- `src/preload/onlypreview/search/core/sqlite-index.mjs` - name-lookup statements over
  `files.normalized_title` and over the persisted `search_tree` rows
- `src/preload/onlypreview/search/core/global-search-files.mjs` - replace the in-memory scan
- `src/preload/onlypreview/search/core/global-search-executor.mjs` - only if the scope decision says
  the section should honour the scope; otherwise untouched
- `tests/onlypreview/` - parity and ordering coverage

## Steps

1. Add the name-lookup statements and confirm with `EXPLAIN QUERY PLAN` that they are index-driven,
   not full scans (`node tests/indexing/bench/explainQueryPlans.bench.mjs`).
2. Replace the scan. Collect matches, order with `compareOnlyPreviewTreeEntries`, then cap - never
   `LIMIT` in SQL, because SQL cannot express that order and would return a different page.
3. Bound the collected set and report explicitly when the bound is reached.
4. Prove ordering parity at caps below the match count, where ordering decides which rows survive.
5. ~~Only after the product decision: pass the validated scope through instead of the hardcoded
   `{ kind: 'project' }`.~~ Done in [task 178](onlypreview-files-section-scope-178.md).

## Acceptance

- Byte-identical relative paths, order and `truncated` at project scope for every benchmark query, at
  several caps including caps below the match count.
- The Files-branch per-query cost no longer scales with workspace size: ~200ms at 130,000 synthetic
  entries becomes single-digit milliseconds.
- `normalizeSearchText` is no longer called once per entry per query on this path.
- No long uninterruptible turn is introduced; the current code yields every 128 entries.
- Existing `tests/onlypreview/*` suites pass unchanged; `planMatrix --plans A` still reports parity
  PASS.

## No longer blocked

Both blockers cleared on 2026-09-16:

- **Product decision: answered "no".** Owner: 「files 的部分也要受到 Contents scope 的限制」. The
  section is no longer project-wide, and Step 5 of this task - passing the validated scope instead
  of the hardcoded `{ kind: 'project' }` - shipped in
  [task 178](onlypreview-files-section-scope-178.md), along with the priority-lane site this task
  never listed.
- **Task 043** is implemented.

What remains here is Steps 1-4, the part this task was actually about: answer the section from the
index instead of rescanning every tree entry. Scoping bounded the scan but did not remove it, so the
~200ms project-wide floor at 130,000 entries is unchanged - a Project-scope query still walks the
whole tier. Note for whoever picks it up: the three call sites feed a **lazy generator**
(`filesWithRecentListings` merges the browse index over `treeEntries`), not the sorted array, so a
binary-searched range slice over `compareOnlyPreviewTreeEntries` order does not apply where it
looks like it should.
