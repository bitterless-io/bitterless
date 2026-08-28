---
id: onlypreview-global-search-concurrency-directory-ux-040-1
status: pass
reviewed_task: onlypreview-global-search-concurrency-directory-ux-040
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-contract-and-concurrency-review
---

# onlypreview-global-search-concurrency-directory-ux-040 — Review 1

- Result: **PASS**
- Scope: task-scoped cooperative Files/Contents execution, index-lease and cancellation drain,
  folder-first bounded ordering, live Current-directory synchronization, nested directory reveal,
  centered Project focus, Renderer-only `folder` presentation, and existing latest-only/token
  fences. Task 038/039, Translator, and other dirty-worktree changes were preserved and excluded.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

No P1, P2, or P3 finding was found.

## Reviewed contracts

### Files and Contents are cooperative siblings under one retained index lease

- `src/preload/onlypreview/search/core/global-search-executor.mjs:111-169` preserves the announced
  promotion gate, selected-file priority lane, initial metadata readiness, and scoped first-build
  Contents path before acquiring the authoritative reader.
- `global-search-executor.mjs:169-228` increments `activeQueryCount` once for both authoritative
  branches, invokes Files and Contents without awaiting either first, and settles them through
  `Promise.allSettled()`. A branch failure flips the shared cancellation predicate; the `finally`
  releases the index only after both siblings have settled.
- The task regression proves Contents starts before the Files iterator exits and the terminal
  response waits for Contents. An independent reverse-failure probe additionally made the Files
  iterator throw and confirmed Contents observed sibling cancellation while
  `activeQueryCount === 1`; the final count returned to zero only after Contents exited.
- Existing coordinator one-active/one-latest behavior remains unchanged. Cancellation still flows
  through the shared predicate, request failure revokes the result session, and terminal
  replacement occurs only after both authoritative outcomes are available.

### Folder-first Files ordering is stable, bounded, and applied before capabilities

- `src/preload/onlypreview/search/core/global-search-files.mjs:55-88` performs one time-sliced
  metadata pass, retains at most one 250-entry directory partition plus one 250-entry file
  partition, preserves traversal order inside each, concatenates folders first, and only then
  slices to the section cap.
- `matchCount > maxResults` derives truncation from every matching metadata entry rather than the
  retained arrays. Directory-saturated, mixed, file-filled, and overflow regressions prove the
  ordering and truthful cap behavior.
- `global-search-executor.mjs:187-241` issues authoritative Files tokens in that partitioned order,
  independently retains the 250 Contents ceiling, and replaces the terminal token authority with
  at most 500 rows total. No second traversal, SQLite connection, Renderer, or Main filesystem path
  was introduced.

### Explicit Project selection keeps Current directory live without redundant Project searches

- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:202-211,655-665` resolves one
  explicit tree-selection directory and synchronizes it only from entry activation. Roving focus
  and result selection have no synchronization call.
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts:216-227` updates the live
  path and label immediately. Only a changed path with non-empty query and directory scope bumps
  the input revision, cancels the accepted active request, and schedules the debounced latest
  request. Project scope records the new anchor without cancellation or dispatch; switching back
  uses that latest anchor.
- Watch commits still supersede an active query because Files is project-wide even when Contents
  is directory-scoped. Request/revision/context fences continue rejecting stale terminal and
  preview commits.

### Directory-result reveal commits only after the complete target is available

- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchTree.service.ts:7-36` demand-loads the
  root-backed ancestry and target direct children before adding root, every ancestor, and the
  target to `expandedPaths`. Missing/stale/failed listings return `false` before selection or
  expansion is committed.
- `onlyPreviewShell.store.ts:667-691` selects and focuses the directory only after reveal succeeds.
  `onlyPreviewGlobalSearch.store.ts:268-283` then exits with one single-use centered target; a
  failed reveal leaves the search query, accepted rows, selection, and preview active.
- `src/renderer/onlypreview/shell/src/App.vue:521-547` consumes that target once after Global Search
  exits, restores Preview bounds, discards the old search focus authority, and calls the existing
  Project focus helper with centered scrolling. Source and service tests cover the full ancestor
  chain, target/direct-child load, success/failure commit boundary, one-shot intent, and centered
  DOM focus wiring.

### `folder` is a Renderer presentation and does not alter the protocol

- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchResult.service.ts:161-164` derives
  `folder` only when a Files result has `nodeKind: 'directory'`; ordinary files retain their
  existing media type.
- `src/renderer/onlypreview/shell/src/components/GlobalSearch/SearchResultRow.vue:26-29,64-67`
  renders that derived display value. The strict shared/XPC result still carries directory
  `mediaType: 'unknown'`, so no payload shape, preview capability, or Main validation changed.

## Out-of-scope stale test assessment

`tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs` is unchanged by task 040. It still
reads the retired merged `response.results` field instead of the current grouped `files` and
`contents` response, and one case launches two never-cancelled `engine.search()` calls directly,
bypassing the coordinator that owns the one-active/one-latest contract. Its stale assertion and
failure-path open handle are pre-existing test drift from the grouped-search transition, not a
failure of task 040's implementation, and are not a delivery blocker for this task.

## Verification

| Command / evidence | Result |
| --- | --- |
| Task-listed focused Node suites | **PASS, 46/46** |
| Independent Files-failure / Contents-drain probe | **PASS:** sibling cancelled and drained while reader count remained 1 |
| `yarn typecheck:node` | **PASS** |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS** |
| `yarn build` | **PASS**; validation-only package-name mutation restored to its prior value |
| `git diff --check` | **PASS** |
| Full `yarn typecheck:web` | Existing unrelated Poker, Home, Connector, Maestro, Omni, and `pathHelper` errors only; no task-scoped error |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**PASS — task 040 matches the accepted design and is ready for Ral's live acceptance.** Files and
Contents now execute as drained cooperative siblings, authoritative Files is stably folder-first
within its resource bounds, explicit Project selection keeps Current directory live without
Project-scope churn, nested folder reveal expands/selects/centers only on success, and the visible
`folder` type remains a Renderer-only derivation.
