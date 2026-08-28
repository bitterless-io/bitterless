---
id: onlypreview-directory-selection-search-scope-038-1
status: blocked
reviewed_task: onlypreview-directory-selection-search-scope-038
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-source-contract-and-concurrency-review
---

# onlypreview-directory-selection-search-scope-038 — Review 1

## Findings

### [P2][blocking] A queued search can repeatedly reacquire the reader count and starve candidate promotion

The task requires one-active/one-latest search, bounded resource behavior, and safe concurrency
between initial build/reconcile, promotion, and queries
(`docs/plan/tasks/onlypreview-directory-selection-search-scope-038.md:62-67`;
`docs/design/onlypreview-global-search.md:145-151,206-219`). The new reader counter does prevent an
index from being closed while the counted query is using it, but the executor has removed the
previous `promotionPromise` gate.

`src/preload/onlypreview/search/core/search-engine.mjs:341-363` publishes `promotionPromise`, then
polls `activeQueryCount` with `setImmediate()` before closing and swapping the active index.
Meanwhile every new Global Search request can increment the count at
`src/preload/onlypreview/search/core/global-search-executor.mjs:110-120` and again at `:158-188`
without first waiting for an already-pending promotion. In the production latest-only scheduler,
an active request's completion immediately dispatches the pending request from a Promise
continuation (`src/preload/onlypreview/search/core/single-flight.mjs:37-40`). That microtask starts
the next reader before the promotion loop's next `setImmediate` turn. On a large project where a
query takes longer than the 120 ms input debounce, continued input can therefore hand the reader
count from Q1 to Q2 to Q3 indefinitely: refresh or full watch reconciliation finishes its candidate
but cannot promote it until the user stops searching.

This is writer starvation rather than the narrower close race one might infer from
`waitsForInitialBuild`: after `waitsForInitialBuild` is computed at
`global-search-executor.mjs:126-127`, execution reaches the second `activeQueryCount += 1` at `:158`
without an `await`, so JavaScript run-to-completion prevents promotion from entering that exact
gap. Likewise `closeIndex(this.index)` and `this.index = undefined` at
`search-engine.mjs:353-355` have no intervening `await`. The missing gate is still blocking because
new readers are admitted after the writer has already announced promotion.

Wait for an existing `promotionPromise` before acquiring a new active-index reader, without holding
`activeQueryCount` during that wait; re-establish the request session after the swap because
promotion revokes its tokens. Preserve the intended behavior that the old index remains searchable
while a refresh candidate is merely building and no promotion is pending. Add a deterministic test
that holds Q1 while real promotion starts, queues Q2, and proves promotion settles before Q2 can
acquire the replacement index. The current test at
`tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs:218-275` pauses in a wrapper *before*
`promoteCandidate()` creates `promotionPromise`, so it does not exercise this writer-waiting state.

### [P3][non-blocking] The Contents-only first-build traversal retains an unused duplicate metadata tree

`searchScopedContentsWithoutActiveIndex()` no longer uses filename/directory results, but
`src/preload/onlypreview/search/core/global-search-executor.mjs:58-66` still calls
`createWorkspaceTraversal()` with its default `collectTreeEntries: true`. The selected subtree's
entire `treeEntries` array is therefore accumulated while the same first build already retains the
project candidate metadata. It is released after the scoped search and remains time-sliced, so this
does not by itself block the contract, but it is avoidable peak memory on a large Current directory.
Pass `collectTreeEntries: false` for this Contents-only traversal and keep the existing entry stream
for the temporary SQLite rebuild.

## Verified behavior

- Preview-file selection remains in `selectedRelativePath`; the new
  `treeSelectedRelativePath` independently owns Project-tree selection and derives a selected
  directory, selected-file parent, Preview-file parent, or root.
- Directory pointer single-click selects without changing expansion. Double-click and keyboard
  activation select before toggling expansion. File single/double-click settings remain separated.
- Project rows bind the independent state to both the Royal selected class and `aria-selected`;
  workspace replacement, restore/external selection, Locate, file selection, and directory reveal
  synchronize/reset it along the documented paths.
- Global Search captures Current directory only on inactive-to-active entry. Roving focus and later
  tree changes do not mutate the captured anchor; the selector alone changes Contents scope.
- Files searches project-wide, time-sliced `treeEntries` and includes directories. Contents and the
  selected-file content lane remain scoped. Directory metadata is not yielded to SQLite/FTS and
  filename matching opens no file body.
- Both visible sections remain capped at 250, with at most 500 session tokens/results. The terminal
  first-build response waits for the existing candidate metadata and starts no second project-wide
  traversal.

## Verification

| Command / evidence | Result |
| --- | --- |
| `node --test tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs` | **PASS, 22/22** |
| `git diff --check` | **PASS** |
| `node --check` for the three changed search-core modules | **PASS** |
| Source/contract audit of task paths plus coordinator/single-flight/promotion integration | **BLOCKED by P2 above** |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**BLOCKED.** Directory selection, Current-directory capture, project-wide Files, scoped Contents,
directory metadata ownership, and visible collection limits align with the accepted design. Task
038 is not deliverable until a pending promotion prevents later searches from continuously
reacquiring the active-index reader count. The unused scoped metadata collection is non-blocking but
should be removed while touching the same helper.
