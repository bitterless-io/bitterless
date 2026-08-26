# onlypreview-selected-file-index-priority-034 — Review 3

- Date: 2026-08-26
- Result: **PASS**
- Scope: independent final re-review of the Review 2 blocker, both previously closed P1 findings,
  and the current-worktree task 034 integration. Unrelated dirty-worktree changes were preserved and
  excluded.
- Method: task/design/prior-review/source inspection, mechanical before/after watch extraction
  comparison, focused plus watch/boundary/recovery/traversal Node tests, Node typecheck, line/function
  audit, and tracked plus task-owned untracked whitespace checks.
- E2E/live app: intentionally not run. Build, Electron, Playwright/E2E, the real application, and
  packaged smoke were excluded by the assigned verification contract.

## Findings

### 1. P3 · non-blocking — task `Path` metadata still omits task-owned modules

- Workflow contract: `docs/plan/tasks/onlypreview-selected-file-index-priority-034.md:20-41` is the
  task ownership/recovery path.
- Code evidence: task 034 now owns
  `src/preload/onlypreview/search/core/search-scope.mjs`,
  `src/preload/onlypreview/search/core/selected-file-priority-lane.mjs`,
  `src/preload/onlypreview/search/core/traversal.mjs`,
  `src/preload/onlypreview/search/core/watch-reconciler.mjs`, and
  `src/renderer/onlypreview/shell/src/onlyPreviewSelectedFilePriority.service.ts`, but the task path
  does not list them.
- Impact: a future recovery or review following only task metadata can miss the modules that contain
  the priority/depth/watch blocker fixes. Runtime behavior and verification are unaffected.
- Required correction: add the five files to the task `Path` list when task 034 is closed.

No P1/P2 blocker or new functional regression was found.

## Prior blocker closure

### Review 1 finding 1 — priority failure poisons Project Search: remains closed

- `src/preload/fileSearch/fileSearchCoordinator.ts:140-146` exposes the original priority operation
  to its caller but stores a non-rejecting `operation.catch(() => undefined)` as the ordering
  barrier. Project Search therefore waits for the latest bounded priority job without inheriting an
  optimization failure.
- The real-coordinator failure regression remains green: the priority call reports its failure and
  the following search reaches the engine and returns its authoritative response.

### Review 1 finding 2 — priority bypasses traversal depth: remains closed

- `src/preload/onlypreview/search/core/traversal.mjs:42-51` supplies the single
  `isWorkspaceSearchPathWithinDepth()` predicate used by ordinary recursion and the selected-file
  lane.
- `selected-file-priority-lane.mjs:53-69` rejects an over-depth file before body I/O. The depth-32
  regression remains green.

### Review 1 finding 3 / Review 2 finding 1 — oversized task-scoped source: closed

- `src/preload/onlypreview/search/core/search-engine.mjs` is now **706 lines** and
  `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` is **799 lines**. Both satisfy the
  project `TS-1` limit.
- The extracted `watch-reconciler.mjs` is 306 lines and owns one cohesive responsibility: changed
  path revalidation, incremental tree/index mutation, parent listing publication, and watch commit
  projection.

## Watch extraction regression audit

- **Queue and generation:** `search-engine.mjs:210-218` still captures a per-controller
  `watchRevision`, enters reconciliation only through the engine's serial `enqueue()`, and rejects a
  late callback after workspace replacement or shutdown before the reconciler resolves context.
- **Full refresh and build-state latch:** `watch-reconciler.mjs:90-105` preserves the old
  no-index return, non-ready `watchNeedsFullReconcile` latch, config/oversized/full escalation to
  `refreshInternal()`, and authoritative full commit ordering. Candidate promotion and refresh stay
  serialized with watch work.
- **Incremental mutation:** `watch-reconciler.mjs:106-200` is a mechanical `this` → resolved engine
  context move of the previous file/directory/symlink/ENOENT/rename branches. It preserves
  containment and repeated-realpath checks, policy decisions, SQLite mutation, tree upsert/subtree
  removal, snapshot → changed-parent listing → commit order, and escalation on uncertain state.
- **Injected read seam:** `search-engine.mjs:110-124` passes the exact constructor
  `readWorkspaceFile` dependency to both the priority lane and watch reconciler. Boundary tests prove
  incremental watch reads still use this injection, while oversized/full refreshes bypass it and run
  normal traversal.
- **Parent listings and errors:** `watch-reconciler.mjs:233-301` retains parent identity validation,
  directory-token lookup, bounded per-parent publication, and the prior best-effort delivery error
  semantics. Reconcile failures still reject to `watch-controller.mjs`, whose full-retry latch owns
  recovery; delivery callbacks cannot roll back an index commit.
- **Lifecycle and boundedness:** `search-engine.mjs:686-704` still revokes priority, increments
  `watchRevision`, closes the old controller without draining, and clears active authority. Watch
  paths remain bounded by `MAX_WATCH_CHANGE_PATHS`; priority remains one active plus one latest
  pending job and one retained one-file SQLite lane, so selection storms cannot accumulate bodies or
  parallel index jobs.

## Final task contract audit

- A→B latest-only revision/build/generation fences, candidate privacy, early exact-path deduplication,
  authoritative terminal replacement, cancellation, promotion cleanup, and priority failure
  isolation remain intact.
- Priority admission retains relative-path validation, shared depth, containment/no-follow symlink,
  fixed/config exclusion, classification/extension, size, tolerant decode, opened identity,
  post-read stability, and stale-generation parity with normal indexing.
- Main validates and relays the exact host/workspace/generation/relative-path request and exact
  response envelope; it performs no file/index I/O. Public priority traffic contains no absolute
  path or file body. Shell selection dispatch is fire-and-forget after successful activation and
  does not await indexing or surface priority failure as a Preview error.
- First-build `In Directory` remains a complete same-policy scoped traversal; first-build
  `In Project` still waits for candidate promotion. The one-file lane is the only early source, and
  candidate partial rows remain unqueryable.

## Code Review 报告

- Rules: `TS-1`, `TS-2`. No task-scoped Vue SFC or backend implementation was authored, so `FE-*`
  and `BE-*` do not apply.

### 文件清单

| # | 文件 / 责任组 | 问题数 |
|---|---|---:|
| 1 | Shared contract/types | 0 |
| 2 | Main XPC handler + file-search relay | 0 |
| 3 | Hidden preload/runtime/coordinator | 0 |
| 4 | `search-engine.mjs` | 0 |
| 5 | `search-scope.mjs` | 0 |
| 6 | `selected-file-priority-lane.mjs` | 0 |
| 7 | `traversal.mjs` | 0 |
| 8 | `watch-reconciler.mjs` | 0 |
| 9 | Shell store + priority service | 0 |
| 10 | Task-focused tests | 0 |

### 问题清单

None. Every reviewed implementation/test file is at or below 800 lines. The named async generator
inside traversal is not arrow-replaceable; no replaceable function declaration/expression was found.

## Verification

| Command / audit | Result |
|---|---|
| Focused + `onlyPreviewSearchEngine.boundary/recovery/traversal` Node tests | **PASS, 49/49** |
| `yarn typecheck:node` | **PASS** |
| Tracked whole-worktree `git diff --check` | **PASS** |
| Task-owned untracked-file `git diff --no-index --check --no-patch` audit | **PASS** |
| Task-scoped line-count / `function` audit | **PASS:** engine 706, Shell 799, all reviewed files ≤800; `TS-2` clean |
| `yarn build` | Not run; explicitly excluded from this re-review |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**PASS — all three original blockers are closed, the watch extraction is behavior-preserving, and no
new correctness, security, or device-freeze blocker was found.**

Task 034 is ready for owner runtime acceptance. The stale task `Path` metadata should be corrected
when the task is closed, but it does not block this implementation.
