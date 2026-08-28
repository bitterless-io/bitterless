---
id: onlypreview-warm-search-before-reconcile-042-1
status: blocked
reviewed_task: onlypreview-warm-search-before-reconcile-042
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-contract-and-performance-review
---

# onlypreview-warm-search-before-reconcile-042 — Review 1

- Result: **FAIL (BLOCKED)**
- Scope: task-042 paths and their required Shell/runtime integration only. Existing task 038–041,
  Translator, and other dirty-worktree changes were preserved and excluded where unrelated.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking: schema-7 upgrade can bless retained tree residue as an authoritative v8 tree

`src/preload/onlypreview/search/core/sqlite-schema.mjs:96-104` treats every valid schema-7 content
database as an additive upgrade, but only executes `CREATE TABLE IF NOT EXISTS search_tree` and
increments `user_version`. It neither clears an already-present `search_tree` nor removes
`tree_state`, `tree_build_id`, and `tree_max_depth_reached` from `index_meta`.
`src/preload/onlypreview/search/core/sqlite-index.mjs:315-346` then accepts those retained values
whenever `tree_state=ready` and `tree_build_id` matches the preserved content build.

An isolated probe created a valid ready v8 cache, changed only `PRAGMA user_version` to 7, and
reopened it. The reported migration was additive (`rebuilt: false`) but returned
`treeMetadataReady: true` and the retained directory. This violates the explicit first-upgraded-run
contract: every v7 cache must preserve content/FTS/build identity while starting with no valid tree
authority. The migration must transactionally reset the tree rows and every `tree_%` marker before
publishing v8.

### P2 — blocking: a later bounded watch can recertify a stale tree after marker invalidation

`src/preload/onlypreview/search/core/watch-reconciler.mjs:119-134` permits bounded mutation whenever
the engine state is `ready`; it does not require `context.treeMetadataReady`. After invalidating the
marker, the bounded path mutates content and calls `applyTreeSnapshotMutations` at lines 256-317.
That method unconditionally rewrites `tree_build_id`, depth, and `tree_state=ready` at
`src/preload/onlypreview/search/core/sqlite-index.mjs:399-429`, even if the preexisting tree was
already invalid.

The reproduction deleted a folder, forced its tree commit to fail after marker invalidation, then
processed an unrelated root-file watch event in the same runtime. The first read correctly returned
`treeMetadataReady: false`; the second returned `true` and resurrected the deleted folder from stale
`search_tree` rows. Once tree authority is invalid, bounded deltas cannot prove completeness; the
next watch must take the full-reconcile path before restoring the marker.

### P2 — blocking: large merge tails use argument spread and can corrupt the in-memory filename view

Both sorted merge helpers finish by spreading an unbounded tail into `Array.prototype.push`:

- `src/preload/onlypreview/search/core/filename-tier.mjs:15-29`
- `src/preload/onlypreview/search/core/watch-reconciler.mjs:96-110`

With 130,000 retained filename records and one early-sorting upsert, `FilenameTier.applyBatch()`
throws `RangeError: Maximum call stack size exceeded`. More importantly, lines 85-109 update
`records` and `estimatedBytes` before the throwing merge assigns `sortedVisibleRecords`; the probe
therefore ended with `records.has(upsert) === true` but no corresponding visible record. This is a
real large-workspace correctness failure, not only a micro-optimization issue. Append remaining
items iteratively (or otherwise without an argument-count-dependent spread) in both helpers and add
a large-tail regression.

### P2 — blocking: bounded watch indexing escapes the traversal depth boundary

The authoritative traversal predicate at
`src/preload/onlypreview/search/core/traversal.mjs:48-51,266-268` stops below directories with 32
segments and records `maxDepthReached`. The bounded watch path at
`src/preload/onlypreview/search/core/watch-reconciler.mjs:139-227` validates containment, policy,
type, and parent presence, but never applies that depth predicate before reading and upserting a
file.

An isolated 32-directory probe confirmed the file below the boundary was absent after a true first
build, then became indexed and Contents-searchable after one bounded watch event. Incremental and
full reconciliation therefore produce different searchable sets. Reject/promote such a watch hint
to full reconcile using the shared depth predicate before reading or indexing the file.

### P2 — blocking: an absent or malformed maximum-depth marker is still treated as a ready tree

`src/preload/onlypreview/search/core/sqlite-index.mjs:315-346` excludes
`tree_max_depth_reached` from `treeMetadataReady`; any value other than the exact string `"1"`,
including a missing key or corrupt value, is silently interpreted as `false`. Deleting only that key
from a valid cache reproduced `treeMetadataReady: true`, returned persisted directories, and
reported `maxDepthReached: false`.

The v8 tree snapshot is a compound persisted authority, and its completeness bit affects the public
`truncated` claim. Require an exact `"0"` or `"1"` value as part of ready-marker validation;
missing/invalid values must retain the reusable content index but fail closed to file/Contents-only
warm results.

### P2 — blocking: malformed schema-8 tree tables leak SQLite descriptors on constructor failure

`src/preload/onlypreview/search/core/sqlite-schema.mjs:94-96` declares schema 8 current when the
required object names exist; it does not validate the `search_tree` shape. The constructor at
`src/preload/onlypreview/search/core/sqlite-index.mjs:138-146` opens `DatabaseSync` and then prepares
tree statements (including lines 200-204) without a failure guard that closes the database.

After replacing a valid cache's `search_tree` with `CREATE TABLE search_tree (bad TEXT)`, 100 caught
constructor failures increased the process descriptor count from 12 to 213. A corrupt cache can
therefore exhaust file descriptors during repeated recovery attempts. Validate the additive/current
tree shape and close the database on every constructor-initialization failure before rethrowing.

### P2 — blocking performance: a maximum bounded watch batch performs O(P×N) tree scans

For every one of up to `MAX_WATCH_CHANGE_PATHS = 512` paths,
`src/preload/onlypreview/search/core/watch-reconciler.mjs:139-149` scans all `context.treeEntries`
with `.some()`. File/removal handling can additionally call
`readParentDirectoryTreeEntry`, whose lines 361-369 perform another full `.find()` per path. On the
large projects this task targets, a valid bounded batch can therefore do 1,024 full-tree scans
before the later linear merge, blocking the hidden runtime and delaying both watch convergence and
search.

Build one path-keyed lookup for the batch (or maintain an equivalent bounded authority) and use
constant-time exact-parent/replacement checks. This must not become a Renderer scan or add
filesystem/SQLite work.

### P2 — blocking: selected-file priority supersession revokes an unrelated active search session

`src/preload/onlypreview/search/core/search-engine.mjs:250-253` calls
`globalSearchSession.revoke()` whenever the selected-file priority lane is superseded. Ordinary
Global Search uses that same shared session: it begins at
`src/preload/onlypreview/search/core/global-search-executor.mjs:293-294`, then issues batches and the
terminal at lines 299-320.

Starting an ordinary ready-index search and immediately calling `supersedePriority()` reproduced a
failed search with `TypeError: Global search request is stale`. A Project selection/priority update
must not cancel a separately accepted Global Search request. Revoke only capabilities actually
owned by the superseded priority operation; ordinary request cancellation remains request-scoped.

### P3 — blocking maintainability: task-owned JS modules exceed the 800-line limit

The workspace code-review rule limits TypeScript/JavaScript files to 800 lines. This task expands
`src/preload/onlypreview/search/core/search-engine.mjs` from 610 to 850 lines and
`src/preload/onlypreview/search/core/sqlite-index.mjs` from 794 to 980 lines. The new lease,
promotion, persisted-tree, and schema/index responsibilities provide natural module boundaries;
split them without changing behavior before acceptance.

## Reviewed contracts without additional findings

- Reusable-index warm Files and Contents start together, stream before startup reconcile/promotion,
  remain pending, and rerun under a fresh token session after successful promotion. Candidate
  failure with the original warm index still active terminals from the warm outcome.
- Reader acquisition captures one index/tree/depth/policy/identity tuple and rechecks the writer
  gate; promotion, watch, and shutdown raise the same writer gate and wait for readers. Candidate
  visibility, index close ordering, cancellation drain, and promotion recovery were otherwise
  consistent in the reviewed paths.
- Preview authority carries the captured policy/identity, and successful promotion revokes old
  result tokens before fresh terminal replacement. Section caps, exact-path deduplication,
  folder-first Files order, directory scope, and candidate isolation are retained.
- True first build remains fail closed for project-wide Files while selected-file priority and the
  bounded current-directory Contents path may stream. No extra Renderer, connection, XPC request,
  Main filesystem I/O, query/path logging, or unbounded result collection was added.
- Shell gating is correctly based on the root Browse projection, not the initialize response:
  `onlyPreviewShell.store.ts:110-112,221-230` maps `ready` to `projectionReady`; root listing
  acceptance at lines 592-602 resumes search; `onlyPreviewGlobalSearch.store.ts:304-350` gates only
  on that context. The hidden runtime installs its active coordinator before awaiting initialize
  (`fileSearchRuntime.ts:123-139`) and relays browse/search-batch events while the RPC remains
  pending (`fileSearchRuntime.ts:254-270`). Because the engine emits the root listing before full
  count at `search-engine.mjs:360-380`, both the listing and warm batches can reach the UI during the
  pending initialize RPC.

## Verification

| Command / evidence | Result |
| --- | --- |
| Task-listed focused Node suites | **PASS, 78/78** |
| `yarn typecheck:node` | **PASS** |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS** |
| `yarn build` | **PASS**; existing Vite chunking notices only |
| `git diff --check` | **PASS** |
| v7 residue + interrupted-watch temp probes | **FAIL as expected:** retained directory was ready after migration; stale deleted directory was ready after a later bounded watch |
| 130k-record filename-tier probe | **FAIL as expected:** `RangeError`; map updated while visible projection was not |
| depth-boundary temp-workspace probe | **FAIL as expected:** initially absent file became indexed/searchable after bounded watch |
| missing-depth-marker probe | **FAIL as expected:** tree remained ready and directories were published |
| malformed-schema repeated-open probe | **FAIL as expected:** 100 failures retained 201 additional descriptors until process/GC cleanup |
| priority/session concurrency probe | **FAIL as expected:** ordinary search terminaled `Global search request is stale` |
| Electron / Playwright / E2E / real app | Not run, as required |

## Coverage gaps

- The schema-7 regression at
  `tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs:92-96` explicitly drops
  `search_tree` and deletes `tree_%` before migration, so it cannot detect retained residue.
- The interrupted-watch regression at lines 377-463 shuts down and completes a full initialize
  before its successful bounded watch; it does not exercise a second bounded event against the same
  invalid runtime tree.
- No focused regression covers a large sorted merge tail, bounded watch at the depth boundary,
  missing/garbage depth metadata, malformed schema constructor cleanup, a maximum-size watch batch
  over a large tree, or priority supersession concurrent with ordinary Global Search.
- Engine and Shell tests separately prove pre-promotion batches and acceptance while a search RPC is
  pending, but no production-chain non-E2E harness holds the actual initialize RPC pending while
  asserting root-listing projection readiness and Shell batch rendering together. Static control-flow
  inspection confirms the path today; a single integration regression would protect this central
  startup contract.

## Conclusion

**FAIL / BLOCKED.** The central warm-search and Shell-readiness design is present and the prescribed
suite, type checks, and build pass, but the persisted-tree migration/watch authority is not
fail-closed, large bounded updates can fail or scale quadratically, depth and schema corruption
escape their guards, priority supersession can abort a live search, and both core modules exceed the
workspace size limit. The task requires remediation and a fresh independent review.
