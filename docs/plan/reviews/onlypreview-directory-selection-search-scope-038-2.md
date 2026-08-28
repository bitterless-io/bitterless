---
id: onlypreview-directory-selection-search-scope-038-2
status: blocked
reviewed_task: onlypreview-directory-selection-search-scope-038
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-source-contract-and-concurrency-rereview
supersedes: onlypreview-directory-selection-search-scope-038-1
---

# onlypreview-directory-selection-search-scope-038 — Review 2

## Findings

### [P2][blocking] Waiting for first-build promotion does not wait for authoritative Files metadata

Review 1's writer-starvation gate is present, but the gate resolves at the SQLite swap boundary,
before the first build commits its project-wide file/directory metadata. The accepted contract says
the terminal Files result must wait for the existing complete candidate metadata
(`docs/design/onlypreview-global-search.md:145-148`;
`docs/plan/tasks/onlypreview-directory-selection-search-scope-038.md:62-65`).

`src/preload/onlypreview/search/core/global-search-executor.mjs:111-116` awaits an existing
`promotionPromise` and re-begins the token session. `promoteCandidate()` resolves that promise in
`src/preload/onlypreview/search/core/search-engine.mjs:376-379`, but the caller does not assign
`this.treeEntries` until `search-engine.mjs:289-291`. After the promotion wait, the executor computes
`waitsForInitialBuild` as `!!activeBuild && !context.index` at
`global-search-executor.mjs:133-134`. The replacement SQLite index already exists by then, so the
predicate is false and the request immediately searches the still-empty `treeEntries` at `:171-177`.
Contents comes from the replacement SQLite index, but Files incorrectly terminates empty.

An independent deterministic probe held a real first-build promotion with one reader, started the
reviewed search while `promotionPromise` was present, released the writer, and queried a workspace
containing `network/guide.txt`. The terminal response produced `files: []` instead of
`['network']`; the assertion failed before token-preview validation. This confirms the ordering is
observable rather than theoretical.

The same readiness model is also insufficient for startup reconciliation of a reusable SQLite
index. `initializeInternal()` assigns the reusable `seedIndex` but clears `treeEntries` at
`search-engine.mjs:211-226`. A search admitted while that initial reconcile is running sees an index,
so `!context.index` again treats Files metadata as ready even though no project metadata has been
committed. This must remain distinct from refresh/full-watch reconcile, where the previous complete
`treeEntries` should stay searchable while the candidate builds.

Represent committed Files-metadata readiness explicitly instead of inferring it only from SQLite
index presence. A search entering before the first initialization/reconciliation has committed
metadata must wait for that active build even if it had to wait through promotion first; after the
last promotion/build revocation it must begin the request session again before issuing tokens.
Refresh of an already initialized workspace must continue using the prior active index and prior
complete metadata until actual promotion. Preserve cancellation checks without holding
`activeQueryCount` while waiting. Add deterministic coverage for a request entering during real
first-build promotion; startup with a reusable SQLite index should also prove that Files does not
terminate from an uncommitted empty metadata array.

The new writer test at
`tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs:283-370` correctly covers refresh, but that
workspace already has a committed `treeEntries` set from initialization, so it cannot detect this
first-initialization failure.

## Resolved from Review 1

- **P2 writer starvation: resolved.** The executor snapshots and awaits an announced
  `promotionPromise` before either reader-count acquisition, does not hold `activeQueryCount` while
  waiting, checks cancellation, and re-begins the request session after promotion. There is no
  asynchronous gap between observing no promotion and incrementing the first reader count. The new
  deterministic refresh test enters real promotion, keeps Q1 active, proves Q2 stays behind the
  writer, then proves Q2 uses the replacement index.
- **P3 duplicate metadata retention: resolved.** The Contents-only temporary traversal passes
  `collectTreeEntries: false` at
  `src/preload/onlypreview/search/core/global-search-executor.mjs:61-66`; it still streams eligible
  files into the temporary SQLite index without retaining an unused subtree metadata array.

## Preserved behavior

- A refresh candidate remains non-blocking before actual promotion: the existing active index and
  committed tree metadata answer Files/Contents while the candidate is only building.
- Once promotion is announced, later readers wait outside the reader count; the writer no longer
  closes a counted index or becomes starved by the latest-only scheduler's pending-query microtask.
- Promotion still revokes selected-file priority and Global Search tokens only after existing
  readers drain. The queued request re-begins its session after the revoke and uses the replacement
  index.
- The initial-build path that begins before promotion still streams scoped Contents, releases its
  temporary reader before awaiting the build, waits for complete project metadata, and replaces
  early priority tokens at the terminal response.
- Directory metadata remains project-wide and in memory only; Contents remains scoped, and visible
  collections/capabilities remain capped at 250 per section.

## Verification

| Command / evidence | Result |
| --- | --- |
| `node --test tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs` | **PASS, 23/23** |
| Independent real first-build-promotion probe | **FAIL as described:** terminal Files was empty for `network` |
| `git diff --check` | **PASS** |
| `node --check src/preload/onlypreview/search/core/global-search-executor.mjs` | **PASS** |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**BLOCKED.** Review 1's writer-starvation and avoidable metadata-retention findings are correctly
fixed, and refresh keeps its old active index until promotion. Task 038 is still not deliverable
because a request entering during first-build promotion can terminate with complete Contents but an
empty Files section, and initial reconciliation still conflates SQLite availability with committed
project Files metadata.
