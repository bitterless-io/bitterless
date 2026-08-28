---
id: onlypreview-warm-search-before-reconcile-042-2
status: pass
reviewed_task: onlypreview-warm-search-before-reconcile-042
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-final-remediation-and-contract-review
supersedes_review: onlypreview-warm-search-before-reconcile-042-1
---

# onlypreview-warm-search-before-reconcile-042 — Review 2

- Result: **PASS**
- Scope: task-042 paths, every Review 1 finding, the follow-up scale/lifecycle findings, and the
  required Shell/runtime integration. Existing task 038–041, Translator, and other dirty-worktree
  changes were preserved and excluded where unrelated.
- Method: task/design/issue/prior-review inspection, final source and regression review, the exact
  task-listed Node aggregate, both directed type checks, production build, line-count audit, and
  whitespace validation.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

No P1, P2, or P3 finding remains.

## Review 1 closure

### Persisted tree authority now fails closed

- `src/preload/onlypreview/search/core/sqlite-schema.mjs:125-139` upgrades schema 7 inside one
  immediate transaction, drops/recreates `search_tree`, deletes every `tree_%` marker, and preserves
  the content schema/build. The regression seeds both a stale tree row and an extra stale marker,
  proves content/FTS counts survive, and proves the first v8 open has no tree authority.
- `src/preload/onlypreview/search/core/sqlite-snapshot-store.mjs:103-135` requires a ready content
  build, a matching non-empty build id, `tree_state=ready`, and an exact maximum-depth value of `0`
  or `1`. Missing, corrupt, or mismatched compound markers retain file/Contents warm access but do
  not publish persisted directories or a false depth claim.
- `src/preload/onlypreview/search/core/watch-reconciler.mjs:136-150` sends any already-invalid tree
  directly through full reconcile. The same-runtime interruption regression forces failure after
  marker invalidation, verifies safe file-only authority, then submits a second bounded event and
  proves it performs one full reconcile before restoring the matching tree marker.
- `sqlite-schema.mjs:90-110` validates the exact schema-8 `search_tree` table shape.
  `src/preload/onlypreview/search/core/sqlite-index.mjs:69-90` closes the `DatabaseSync` handle on
  every configuration, statement-preparation, or hydration failure. The regression repeats a real
  malformed-schema constructor failure 64 times, allows no more than three descriptor fluctuation
  under `/dev/fd`, and then acquires an exclusive SQLite transaction.

### Large-tree merge, depth, and watch work are bounded and consistent

- Both sorted merges append their tails iteratively
  (`filename-tier.mjs:12-36`, `watch-reconciler.mjs:97-118`); no argument-count-dependent spread
  remains. The 130,000-row early-insert regression proves the filename map, visible filename tier,
  and sorted tree projection all contain the same final state without `RangeError`.
- Bounded watch shares the traversal depth predicate at `watch-reconciler.mjs:153-166`. The exact
  boundary regression uses a file immediately below `MAX_INDEX_DEPTH` directories, proves the
  event becomes a full reconcile, and proves the too-deep file remains absent from the index.
- `selectOnlyPreviewTreeEntries()` at `watch-reconciler.mjs:121-128` makes one pass over the retained
  tree for changed paths and their parents; per-path full-tree `.some()`/`.find()` scans are gone.
  Metadata preflight completes before any body read and exits immediately to full reconcile when
  required.
- A valid maximum 512-path bounded event over 130,000 retained tree entries reads file bodies only
  after the writer gate, in `BACKGROUND_BUILD_TRANSACTION_FILES = 10` chunks
  (`watch-reconciler.mjs:278-337`). The regression uses distinct 1 MiB bodies and proves no more
  than ten body values are retained between commits, exactly 52 file-mutation transactions are
  used, all 512 index rows are updated, and the final 130,512-entry tree remains sorted and ready.
- Full SQLite reconciliation batches changed rows and stale deletions by ten
  (`sqlite-index.mjs:483-529`). The focused regression proves 40 upserts plus 200 stale deletes use
  24 transactions, hydrate one consistent final filename tier, and publish the expected counts.

### Reader/writer, cancellation, and priority ownership remain isolated

- Reader acquisition rechecks the announced writer gate plus the captured index, tree, policy, and
  identity before returning a lease (`search-engine.mjs:128-164`). Promotion/watch/shutdown announce
  the same writer gate, drain active readers, mutate or swap authority, and release exactly once.
  Focused races cover cancellation behind the gate, candidate failure, queued readers, shutdown,
  warm replacement, and old-token revocation.
- True first build holds one continuous reader count across selected-file priority and scoped early
  Contents (`global-search-executor.mjs:365-402`), so promotion cannot enter between those phases.
  The deterministic regression uses the actual engine, pauses the priority lane, lets the actual
  candidate reach its writer, then proves the directory-scoped search terminals successfully after
  both complete.
- `search-engine.mjs:207-211` limits priority supersession to the selected-file lane; it no longer
  revokes the ordinary Global Search session. The active-index regression supersedes priority after
  an ordinary warm result and proves the search remains pending, promotes, and terminals normally.
- Coordinator refresh cancels preview work only (`fileSearchCoordinator.ts:162-165`), not an
  accepted search. Its regression covers both successful and failed refresh while a streamed search
  remains active and uncancelled. One-active/one-latest request cancellation remains confined to the
  search scheduler.

### The central warm Shell behavior is exercised through the production chain

- Actual-engine lifecycle tests hold reusable startup promotion, receive both Files and Contents
  while initialize/reconcile remains pending, and then prove a fresh terminal replaces warm rows
  and tokens after offline add/delete/rename. They also cover persisted empty directories,
  symlinks, maximum depth, candidate failure, watch full reconcile, section caps, and folder-first
  ordering.
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs:230-368` is not a boolean readiness
  simulation: it runs the production `FileSearchRuntime`, production coordinator, Main relay,
  `OnlyPreviewBrowseProjectionService`, production Global Search store scheduler, and the real
  relay-backed Shell search client. With initialize and search terminal promises both held, the
  runtime emits the root Browse listing, the projection becomes ready, the pre-entered query is
  dispatched, and the streamed Files batch becomes visible before either terminal is released.
- The harness injects only the deterministic engine boundary needed to hold those phases; every
  runtime/relay/projection/store transition under review is the production implementation.

### Task-owned modules satisfy the repository size/style rules

All 23 task-listed JavaScript/TypeScript source and test files are at or below 800 lines. The largest
are `onlyPreviewSearchRelayAndCoordinator.test.mjs` at 799, `sqlite-index.mjs` at 798,
`search-engine.mjs` at 794, and `onlyPreviewWarmSearchLifecycle.test.mjs` at 759. The new snapshot,
scope, and memory responsibilities are split into cohesive helpers, and the task-owned files contain
no standalone `function` declarations contrary to the workspace arrow-`const` convention.

## Verification

| Exact command / evidence | Result |
| --- | --- |
| `node --test tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewWarmSearchLifecycle.test.mjs tests/onlypreview/onlyPreviewWarmSearchScale.test.mjs tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs tests/onlypreview/onlyPreviewSearchEngineWatchBoundary.test.mjs tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` | **PASS, 86/86**, 0 failed/cancelled/skipped/todo, 1765.072084 ms |
| `yarn typecheck:node` | **PASS**, 3.91 s |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS**, 3.98 s |
| `yarn build` | **PASS**, 25.71 s; existing Vite dynamic/static chunk notices only |
| Task-owned 23-file `wc -l` audit | **PASS**, maximum 799 lines |
| Task-owned standalone-function source scan | **PASS**, no matches |
| `rg -n '\"name\": \"Bitterless_DEBUG_PROD\"' package.json` after build restoration | **PASS**, line 265; `package.json` has no remaining diff |
| `git diff --check` | **PASS** |
| Electron / Playwright / E2E / packaged smoke / real app | Not run, as required |

`yarn build` temporarily set the package name to `Bitterless_DEBUG_DEV`; Review 2 restored only that
field to the required `Bitterless_DEBUG_PROD` value before the final diff check.

## Conclusion

**PASS — task 042 is ready for Ral's live large-project startup acceptance.** Every Review 1 P2/P3
and each follow-up scale/lifecycle issue is closed. The reusable committed snapshot is genuinely
visible through the production Shell chain before initialize/reconcile terminals, fresh promotion
replaces warm authority consistently, corrupted/incomplete tree state fails closed, and reader,
writer, cancellation, priority, file-descriptor, memory, transaction, and module-size boundaries are
covered by the final passing regressions.
