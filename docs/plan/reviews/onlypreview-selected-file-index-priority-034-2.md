# onlypreview-selected-file-index-priority-034 — Review 2

- Date: 2026-08-26
- Result: **BLOCKED**
- Scope: independent re-review of all three Review 1 blockers and the current-worktree task 034
  integration. Unrelated dirty-worktree changes were preserved and excluded.
- Method: task/design/review/source inspection, focused Node tests, Node typecheck, line/function
  audit, and task-scoped plus whole-worktree whitespace checks.
- E2E/live app: intentionally not run. Build, Electron, Playwright/E2E, the real application, and
  packaged smoke were excluded by the assigned verification contract.

## Findings

### 1. P2 · blocking — `search-engine.mjs` still exceeds the 800-line review limit

- Review contract: Review 1 finding 3 and workspace code-review rule `TS-1` require every reviewed
  TypeScript/JavaScript file to remain at or below 800 lines; the task-before baseline is not an
  exemption.
- Code evidence:
  - `src/preload/onlypreview/search/core/selected-file-priority-lane.mjs:1-158` now owns the complete
    one-file lane, and `src/preload/onlypreview/search/core/search-scope.mjs:1-40` owns strict scope
    validation. These are coherent extractions.
  - `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` is now 799 lines, so the Shell
    half of Review 1 finding 3 is closed.
  - `src/preload/onlypreview/search/core/search-engine.mjs` remains 980 lines, still 180 lines over
    the explicit limit.
- Impact: Review 1 finding 3 is only partially fixed. The engine still combines candidate build /
  promotion, refresh, query selection, watch reconciliation, tree mutation, memory/snapshot, and
  browse-event projection in one oversized owner.
- Required correction: extract the next smallest cohesive responsibility with enough margin. The
  minimal useful boundary is the watch reconciliation slice: changed-path revalidation, watch
  commit publication, changed-parent browse listing, and its tree upsert/remove/parent-refresh
  helpers (`search-engine.mjs:665-846` and `932-954`) can move behind one narrow engine-context
  adapter. That removes more than 200 lines and leaves the engine safely below 800 without mixing
  selected-file priority back into it.

### 2. P3 · non-blocking — task `Path` metadata omits the newly owned modules

- Workflow contract: `docs/plan/tasks/onlypreview-selected-file-index-priority-034.md:20-41` is the
  review/ownership path for task 034.
- Code evidence: the task now owns
  `src/preload/onlypreview/search/core/selected-file-priority-lane.mjs`,
  `src/preload/onlypreview/search/core/search-scope.mjs`,
  `src/preload/onlypreview/search/core/traversal.mjs`, and
  `src/renderer/onlypreview/shell/src/onlyPreviewSelectedFilePriority.service.ts`, but none appears
  in the task's `Path` list.
- Impact: future recovery or independent review following only the task file can miss the exact
  blocker-remediation modules.
- Required correction: add these four files to the task path before closing task 034. This is
  bookkeeping and does not block runtime delivery by itself.

## Review 1 blocker closure

### Review 1 finding 1 — priority failure poisons search: closed

- `src/preload/fileSearch/fileSearchCoordinator.ts:140-146` now keeps two promises with different
  purposes: callers await the original priority operation and still receive a real non-cancellation
  failure, while `latestPriority` stores `operation.catch(() => undefined)` as a non-rejecting
  ordering barrier.
- `waitForLatestPriority()` therefore waits for completion/latest replacement without propagating
  an optimization failure into Project Search.
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs:431-480` executes the real coordinator
  with an injected priority failure, proves the priority call rejects, then proves the following
  search reaches the engine and returns its authoritative result. The focused suite passes.

### Review 1 finding 2 — priority bypasses depth policy: closed

- `src/preload/onlypreview/search/core/traversal.mjs:42-51` exports one
  `isWorkspaceSearchPathWithinDepth()` predicate from the same segment model used by normal
  traversal.
- Normal recursion uses it at `traversal.mjs:266-268`; the selected-file lane applies the same
  file-parent depth predicate before any read at
  `selected-file-priority-lane.mjs:53-69`.
- `tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs:123-168` covers the previous
  32-directory reproduction and proves zero priority reads, zero early rows, and an empty
  authoritative terminal result. The focused suite passes.

### Review 1 finding 3 — oversized task-scoped source: partially closed

- Shell priority dispatch is isolated in the 12-line
  `onlyPreviewSelectedFilePriority.service.ts`; the Shell store is 799 lines and keeps selection
  generation fencing before fire-and-forget dispatch.
- The priority lane and strict scope validator are now separate modules, all below 800 lines.
- The engine remains 980 lines, so the finding stays blocking as Finding 1 above.

## Code Review 报告

- Rules: `TS-1`, `TS-2`; no task-scoped Vue SFC or backend implementation changed, so `FE-*` and
  `BE-*` have no applicable authored source.

### 文件清单

| # | 文件 | 问题数 |
|---|---|---:|
| 1 | `src/shared/onlypreview/onlyPreviewSearch.type.ts` | 0 |
| 2 | `src/shared/onlypreview/onlyPreviewSearch.contract.ts` | 0 |
| 3 | `src/shared/onlypreview/fileSearchRuntime.types.ts` | 0 |
| 4 | `src/main/xpc/onlyPreviewSearchRuntime.handler.ts` | 0 |
| 5 | `src/main/fileSearch/fileSearchRuntimeRelay.service.ts` | 0 |
| 6 | `src/preload/fileSearch/fileSearch.preload.ts` | 0 |
| 7 | `src/preload/fileSearch/fileSearchRuntime.ts` | 0 |
| 8 | `src/preload/fileSearch/fileSearchCoordinator.ts` | 0 |
| 9 | `src/preload/onlypreview/search/core/search-engine.mjs` | 1 |
| 10 | `src/preload/onlypreview/search/core/search-scope.mjs` | 0 |
| 11 | `src/preload/onlypreview/search/core/selected-file-priority-lane.mjs` | 0 |
| 12 | `src/preload/onlypreview/search/core/traversal.mjs` | 0 |
| 13 | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` | 0 |
| 14 | `src/renderer/onlypreview/shell/src/onlyPreviewSelectedFilePriority.service.ts` | 0 |
| 15 | `tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs` | 0 |
| 16 | `tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs` | 0 |
| 17 | `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs` | 0 |
| 18 | `tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | 0 |

### 问题清单

#### 9. `src/preload/onlypreview/search/core/search-engine.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|---:|---|---|---|
| 9.1 | 1-980 | TS-1 | 文件 980 行，仍超过 800 行上限 | 抽出 watch reconciliation、tree mutation 和 changed-parent listing 这一连续责任边界 |

No replaceable `function` declaration/expression was found in the reviewed task files (`TS-2`).

## Regression audit

- The extracted lane preserves A→B revision/build/generation fences, one active plus one latest
  pending path, one retained complete SQLite lane, and deferred close for a captured query.
- Promotion, refresh, build failure, workspace shutdown, and runtime shutdown still revoke the
  lane. Candidate partial rows remain private.
- Relative path, containment, no-follow symlink, fixed/config exclusion, extension/media
  classification, searchable-size, sensitive-file, tolerant-decode, opened-identity, post-read
  stability, and stale-generation guards remain on the hidden-preload path.
- The failure barrier does not add parallel work or retain file bodies. Search still waits only for
  the bounded latest priority job, while selection/Preview fire-and-forget the request.
- Scope validation extraction is behavior-preserving; first-build `In Directory` remains complete,
  and first-build `In Project` still waits for candidate promotion.
- Main continues exact parsing/response validation and performs no file/index I/O. The visible
  Shell receives neither an absolute path nor priority file content.
- Early/authoritative exact-path deduplication, terminal replacement, cancellation, and late batch
  fencing remain intact. No new correctness, security, or device-freeze blocker was found outside
  the remaining `TS-1` gate.

## Verification

| Command / audit | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | **PASS, 26/26** |
| `yarn typecheck:node` | **PASS** |
| Task-scoped and whole-worktree `git diff --check` | **PASS** |
| Task-scoped line-count / `function` audit | **FAIL only TS-1:** engine 980; every other reviewed file ≤800; `TS-2` clean |
| `yarn build` | Not run; the assigned verifier was explicitly told not to repeat it |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**BLOCKED — both P1 correctness blockers are closed, but Review 1's P2/TS-1 gate remains for the
980-line search engine.**

The failure barrier, shared depth predicate, bounded priority lane, candidate isolation, Shell
dispatch, and focused regressions are ready. Re-review is still required after one additional
cohesive extraction brings `search-engine.mjs` below 800 lines; task path metadata should be
updated at closure.
