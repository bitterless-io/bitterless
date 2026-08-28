---
id: onlypreview-cold-folders-native-search-overlay-043-1
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-contract-performance-and-lifecycle-review
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 1

- Result: **FAIL (BLOCKED)**
- Scope: task-043 provisional tree, watcher recovery/exclusion, orphan cleanup, native Global Search
  child view, focus/context/reveal lifecycle, crash isolation, teardown, and security boundaries.
- Excluded as unrelated concurrent work: `tests/indexing/`, tmp/benchmark documents,
  `docs/design/onlypreview-indexing-throughput.md`,
  `docs/features/onlypreview-indexing-benchmark.md`, task 069, and unrelated
  `package.json`/`.gitignore` hunks. No such change was reviewed or modified.
- E2E/live app: intentionally not run. Electron, Playwright, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking performance/correctness: exact excluded-directory descendants still trigger full Search reconcile

The task contract requires physically excluded paths to be partitioned before stat/reconcile and to
never invalidate Search or start a candidate build
(`docs/plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md:35-40`). The current gate at
`src/preload/onlypreview/search/core/watch-reconciler.mjs:49-51,125-168` evaluates only the emitted
child path. `createTraversalPolicy()` at
`src/preload/onlypreview/search/core/traversal.mjs:42-78` applies an exact configured rule to the
exact path; it does not make `isPhysicallyExcludedPath('excluded/child.txt')` inherit the blocked
ancestor from an `exclude: ['excluded']` rule.

Consequently, a watch event for `excluded/child.txt` enters ordinary visible-file reconciliation.
The committed tree correctly contains no `excluded` directory, so parent validation at
`watch-reconciler.mjs:235-255,438-444` fails and escalates the event to a full reconcile. A bounded
temp-workspace probe confirmed `excluded` is excluded while the child reports non-physical, invokes
one refresh, and emits a `full: true` commit. Sustained writes below an exact excluded directory can
therefore recreate the high CPU/disk rebuild loop this task is intended to remove.

The exclusion partition must be ancestor-aware while preserving ordered negation: a descendant
under an exact blocked directory is physical unless a later `!` rule can re-include that descendant.
Add an `exclude: ['excluded']` + `excluded/child.txt` regression proving zero Search stat/body reads,
zero full reconcile, and only the permitted loaded-Browse refresh/non-full commit.

### P2 — blocking lifecycle: refresh globally revokes an accepted Search before the writer fence can cancel or replace it

`src/preload/onlypreview/search/core/search-engine.mjs:569-570` now calls
`globalSearchSession.revoke()` immediately when refresh begins. An already accepted warm search has
begun that shared session at
`src/preload/onlypreview/search/core/global-search-executor.mjs:293-310`; after the refresh starts,
its next batch reaches `src/preload/onlypreview/search/core/global-search-session.mjs:23-32` and
throws `TypeError: Global search request is stale`. The executor reports this as a failure rather
than the request's normal cancellation/terminal replacement path.

This violates task-043's promotion contract: fresh promotion, under the existing reader/writer and
generation fences, must replace provisional rows/tokens
(`docs/plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md:33-34,68-69`). Revocation at
refresh entry happens before those fences and also breaks candidate-failure fallback to the still
committed warm snapshot.

The existing focused race at
`tests/onlypreview/onlyPreviewWarmSearchLifecycle.test.mjs:451-525` fails deterministically: the
first accepted reader is expected to terminate as `CANCELLED` while the queued search waits for
promotion, but instead receives `Global search request is stale`. The exact isolated rerun failed
again. Keep the live request/session valid until request-scoped cancellation or the existing
promotion replacement point; do not revoke the shared session at refresh entry.

## Reviewed contracts without additional findings

- Schema-7 additive upgrade preserves the reusable content tier, invalidates the old tree marker,
  and derives only policy-eligible file ancestors as an uncertified provisional directory tier.
  Empty directories and symlinks are not invented; certified schema-8 promotion replaces the
  provisional tree and revokes old result capabilities at the promotion boundary.
- Candidate/previous cleanup is constrained to the exact active database basename plus
  `.candidate-<uuid>` / `.previous-<uuid>` and their `-wal`/`-shm` companions. Active and unrelated
  database files remain outside the deletion regex.
- Recursive watcher reattachment uses capped exponential backoff; fallback reconciliation is
  completion-aware, does not queue a successor while one is running, and successful reattachment
  clears fallback work. No additional watcher-recovery finding was found beyond the exact-directory
  descendant gap above.
- Global Search is one Main-owned child `WebContentsView`, not a top-level window. It receives the
  same clamped rectangle as Preview, detaches without destroying Preview, reuses its renderer across
  close/reopen, and is re-added after Vue/Chrome Preview attachment to restore topmost order.
- Shell no longer owns the Global Search DOM or reports zero Preview bounds. Context snapshots and
  directory reveal completions use strict host/workspace/generation/action/path validation; failed
  or timed-out reveal keeps Search open, while successful reveal expands/selects/centers Project
  before close/focus.
- Shortcut opener capture is first-entry-only; two-stage Escape and Project/Preview fallback are
  retained. Search renderer load/crash failure destroys only the Search child and does not stop the
  shared file-search runtime or close OnlyPreview.
- The Search child uses the trusted preload with sandbox, context isolation, node integration off,
  web security, CSP, and navigation/window-open fences. Raw Chrome HTML/PDF remains preload-free.
  The Search renderer adds no direct filesystem/SQLite access or Main filesystem I/O.

## Verification

| Check | Result |
| --- | --- |
| `node --test tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs tests/onlypreview/onlyPreviewWarmSearchLifecycle.test.mjs tests/onlypreview/onlyPreviewGlobalSearchView.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs` | **FAIL — 51/52 passed**; queued-reader lifecycle failed with `Global search request is stale` |
| Isolated queued-reader lifecycle rerun | **FAIL — 0/1 passed**, same deterministic error |
| Exact-directory descendant exclusion source audit + bounded temp probe | **FAIL as expected** — one full reconcile is requested |
| `git diff --check` | **PASS** |
| Node/Renderer type checks and `yarn build` | Not rerun in this review; the blocking focused failures make acceptance impossible |
| Electron / Playwright / E2E / packaged smoke / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** The provisional schema-7 recovery, exact orphan cleanup, native topmost Search
surface, context/reveal mediation, crash isolation, focus behavior, and security shape are otherwise
consistent with task 043. Acceptance is blocked because exact excluded-directory descendants can
still start full Search reconciliation, and refresh entry can abort a live accepted query outside
the writer/promotion cancellation contract. Both require remediation and a fresh independent
review.
