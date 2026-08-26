# onlypreview-selected-file-index-priority-034 — Review 1

- Date: 2026-08-26
- Result: **BLOCKED**
- Scope: independent review of task 034's selected-file priority lane, Shell → Main → hidden
  `fileSearch` XPC integration, candidate/active-index concurrency, focused tests, and documented
  search contract. Unrelated dirty-worktree changes were preserved and excluded.
- Method: task/design/source inspection, focused Node tests, an independent depth-boundary probe,
  Node typecheck, code-review rule audit, and whitespace check.
- E2E/live app: intentionally not run. Electron, Playwright/E2E, the real application, packaged
  smoke, and a repeated build were excluded by the assigned verification contract.

## Findings

### 1. P1 · blocking — one priority failure permanently poisons later Project Search requests

- Design contract:
  - `docs/features/onlypreview.md:452-458` requires priority failure to remain non-fatal and never
    become a Preview error.
  - `docs/plan/tasks/onlypreview-selected-file-index-priority-034.md:36-59` requires failure cleanup
    while ordinary Project Search remains authoritative.
- Code evidence:
  - `src/preload/fileSearch/fileSearchCoordinator.ts:91-97` makes every search await the shared
    `latestPriority` promise.
  - `src/preload/fileSearch/fileSearchCoordinator.ts:135-143` catches only `CANCELLED`; every other
    priority rejection is rethrown and the resulting rejected promise is assigned to
    `latestPriority`.
  - `src/preload/onlypreview/search/core/search-engine.mjs:293-329` deliberately catches ordinary
    file-read failures, but an in-memory SQLite construction/upsert failure or another internal
    priority-lane failure can still reject.
- Impact: after one non-cancellation priority failure, all later searches fail at
  `waitForLatestPriority()` without reaching the active index. The poisoned promise remains until a
  later manual selection replaces it, so a best-effort optimization can disable Project Search.
- Required correction: separate the caller-visible priority operation from a non-rejecting wait
  barrier (or make priority failures fully best-effort), then add a coordinator-level regression
  test proving an injected priority failure does not prevent the next active-index search.

### 2. P1 · blocking — the priority lane bypasses the Project Search depth boundary

- Design contract:
  - `docs/features/onlypreview.md:359-380` fixes Project Search traversal depth at 32 and requires
    admission before committing a file.
  - `docs/features/onlypreview.md:452-456` requires the one-file lane to reuse ordinary Project
    Search admission guards.
  - `docs/plan/tasks/onlypreview-selected-file-index-priority-034.md:42-55` requires policy parity
    and an authoritative complete terminal result.
- Code evidence:
  - `src/preload/onlypreview/search/core/traversal.mjs:261-263` stops normal Project Search descent
    at `MAX_INDEX_DEPTH`.
  - `src/preload/onlypreview/search/core/search-engine.mjs:266-329` validates the relative path and
    exclusions but never applies the depth admission before reading/upserting the priority row.
- Independent reproduction: a file at
  `d01/.../d32/too-deep.txt` emitted as an early priority match while the first candidate remained
  private; after promotion, the terminal Project Search result was empty because normal traversal
  correctly excluded that depth.
- Impact: the early lane can expose a result that is not eligible for the authoritative index, so
  policy parity and early/terminal consistency are false at an ordinary, user-reachable demand-
  loaded tree path.
- Required correction: share the depth predicate with normal traversal and reject an over-depth
  priority path before file I/O. Add a focused test proving no early row appears beyond the depth
  limit and the terminal result remains consistent.

### 3. P2 · blocking — task-scoped source exceeds the repository's 800-line TypeScript/JavaScript limit

- Review rule: `TS-1` from the workspace `code-review` skill.
- Code evidence:
  - `src/preload/onlypreview/search/core/search-engine.mjs` is 1,102 lines. It was already 984 lines
    at `HEAD`, and this task adds the priority-lane concern rather than splitting it.
  - `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` is 809 lines. It was 793 lines at
    `HEAD`; this task's 16-line activation relay crosses the limit.
- Impact: both touched orchestration owners violate the explicit review gate; the engine also
  combines build/promotion/watch/query and now selected-file priority lifecycle in one oversized
  class.
- Required correction: extract the priority-lane lifecycle/scheduling from the engine into a
  focused module and reduce the Shell store below 800 lines without moving Vue business flow into
  an SFC.

## Code Review 报告

- Rules: `TS-1`, `TS-2`; no task-scoped Vue SFC or backend implementation was changed, so `FE-*`
  and `BE-*` have no applicable authored source.

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
| 10 | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` | 1 |
| 11 | `tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs` | 0 |
| 12 | `tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs` | 0 |
| 13 | `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs` | 0 |
| 14 | `tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | 0 |

### 问题清单

#### 9. `src/preload/onlypreview/search/core/search-engine.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|---:|---|---|---|
| 9.1 | 1-1102 | TS-1 | 文件 1,102 行，超过 800 行上限；本任务继续加入完整 priority-lane 生命周期 | 抽出单文件 priority lane 的状态、索引生命周期和查询投影 |

#### 10. `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|---:|---|---|---|
| 10.1 | 1-809 | TS-1 | 文件从 793 行增长到 809 行，新增改动使其越过 800 行上限 | 提取窄的 search-priority 协调服务，保留 store 的状态所有权 |

No replaceable `function` declaration/expression was found in the reviewed task files (`TS-2`).

## Passed contract checks

- A→B reads are generation/build/revision fenced; the latest-only scheduler retains at most one
  active and one path-only pending job, while the engine retains at most one complete in-memory
  SQLite lane.
- Candidate rows remain private. Only the separate complete one-file index is queried early;
  promotion, refresh, failure, and shutdown revoke/close the lane, deferring close only while an
  already captured priority query is using it.
- Relative-path normalization, containment, no-follow symlink handling, fixed/config exclusions,
  extension classification, 1MiB body cap, sensitive-file metadata-only handling, tolerant decode,
  opened identity, post-read stability, and stale workspace generation checks are reused or fenced.
- Early and authoritative rows deduplicate by exact relative path. The terminal response carries
  the authoritative canonical result set, and Shell replaces the early projection while rejecting
  late batches after its request fence closes.
- `In Directory` still performs a complete same-policy first-build traversal; first-build
  `In Project` still waits for promotion. No partial candidate query was introduced.
- Shell invokes priority only after successful selection and does not await it. Main performs exact
  request parsing and bounded capability relay only; file/index I/O remains in the hidden preload.
- Main validates the exact void success response. Priority request/error shapes do not relay an
  absolute path or file body to visible renderers.

## Verification

| Command / audit | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | **PASS, 24/24** |
| Independent over-depth selected-file probe | **FAIL as expected:** early priority row present, authoritative terminal row absent |
| `yarn typecheck:node` | **PASS** |
| Task-scoped and whole-worktree `git diff --check` | **PASS** |
| `yarn build` | Not repeated; developer already passed it and the assigned verifier was told not to run it |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**BLOCKED — two P1 contract defects and one P2 code-review gate remain.**

The bounded one-file architecture, candidate isolation, most policy guards, XPC validation, and
selection non-blocking behavior are sound. Delivery still requires making priority failure unable
to poison later searches, enforcing the normal Project Search depth boundary, and bringing the two
touched orchestration files under the repository's 800-line limit before re-review.
