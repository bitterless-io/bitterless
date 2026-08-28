---
id: onlypreview-directory-selection-search-scope-038-3
status: pass
reviewed_task: onlypreview-directory-selection-search-scope-038
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-final-concurrency-scope-and-storage-rereview
supersedes: onlypreview-directory-selection-search-scope-038-2
---

# onlypreview-directory-selection-search-scope-038 — Review 3

- Result: **PASS**
- Scope: Review 2's initial-build/reusable-index metadata blocker, Review 1's writer gate and
  scoped-metadata fix, the current tree-selection/search-scope behavior, and the file-search SQLite
  storage boundary. Unrelated dirty-worktree changes were preserved and excluded.
- Method: task/design/prior-review/source inspection, deterministic first-promotion and reusable
  startup tests, focused renderer/runtime Node tests, static storage audit, syntax checks, and
  whitespace checks.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, packaged smoke, and the real
  application were excluded by the assigned verification contract.

## Findings

No P1, P2, or P3 finding remains.

## Review 2 blocker closure

### First-build promotion commits SQLite and Files metadata at one reader-visible boundary

- `src/preload/onlypreview/search/core/search-engine.mjs:268-294` carries the sorted candidate
  `treeEntries` and `maxDepthReached` into `promoteCandidate()` instead of assigning them after the
  promotion promise has returned.
- `search-engine.mjs:344-385` announces `promotionPromise` before waiting for existing readers,
  revokes priority/result-token sessions only after they drain, swaps and reopens the candidate
  SQLite database, then assigns `treeEntries`, `maxDepthReached`, and `treeMetadataReady = true`
  before resolving the promotion promise in `finally`.
- `src/preload/onlypreview/search/core/global-search-executor.mjs:111-126` waits an already-announced
  promotion before taking a reader count and begins the request session again after the promotion's
  token revoke. A waiting search therefore cannot observe the replacement SQLite index with the old
  empty metadata array.
- The deterministic real-promotion regression holds one reader, lets the first build enter the
  actual writer gate, queues a second search, and proves that its terminal Files result contains
  `network`. The independent Review 2 reproduction now also passes, including result-token preview
  resolution after promotion.

### Reusable SQLite startup cannot return false-empty Files

- `search-engine.mjs:212-228` may expose a reusable seed SQLite index for reconciliation, but resets
  `treeEntries` and marks `treeMetadataReady = false`; index existence is no longer used as a proxy
  for committed project metadata.
- `global-search-executor.mjs:133-168` snapshots the active build and waits outside
  `activeQueryCount` whenever initial tree metadata is not committed. Only after that build has
  promoted both authorities does it re-begin the token session and acquire the final reader at
  lines 169-198.
- The reusable-index regression pauses the startup candidate before promotion and proves the query
  remains pending instead of returning `files: []`; after release it returns `network` from the
  committed metadata.
- Refresh/full reconcile keeps `treeMetadataReady = true` for the previous complete pair, so it
  continues serving the old active SQLite index and old project metadata while the private
  candidate builds. Candidate failure/cancellation therefore does not erase the prior read
  authority, and successful promotion replaces both together.

## Review 1 fixes remain closed

### Writer starvation / closing a queried index

- `global-search-executor.mjs:111-117` has no asynchronous gap between observing no announced
  promotion and incrementing the first reader count. Once a writer announces `promotionPromise`,
  later readers wait without incrementing the count.
- `search-engine.mjs:344-354` publishes that gate before its drain loop, and the final Files plus
  Contents read is covered by one reader count at `global-search-executor.mjs:169-198`.
- The deterministic queued-reader regression proves Q2 remains behind the announced writer while
  Q1 drains and then uses the replacement index. A refresh-only build remains queryable before it
  reaches promotion, preserving the old active-index contract without writer starvation.

### Scoped first-build traversal does not retain duplicate tree metadata

- `global-search-executor.mjs:50-80` builds only the temporary scoped Contents index and passes
  `collectTreeEntries: false`. It no longer allocates an unused second subtree metadata array or
  produces Files from the scoped walk.
- Project Files remains the single sorted candidate `treeEntries` tier and is independently capped
  to 250 visible rows; Contents keeps the same cap, per-file search-size gates, time-sliced
  traversal, cancellation, and isolated temporary-index cleanup.
- Task-owned sources remain within the project size limit: `onlyPreviewShell.store.ts` is 798 lines,
  `search-engine.mjs` 619, and every other reviewed source is smaller.

## Scope and interaction contract

- **Preview selection is isolated.** `selectedRelativePath` remains the Main-owned Preview file,
  while `treeSelectedRelativePath` is separate reactive Shell state. Project selected styling and
  `aria-selected` bind only to the tree state in
  `src/renderer/onlypreview/shell/src/App.vue:158-185`.
- **Pointer and keyboard semantics match.** `onlyPreviewShell.store.ts:276-289,655-665` makes the
  first directory click select/focus without expansion, ignores the second synthetic click, and
  lets `dblclick` select plus toggle. Space/Enter activates the focused row through the same method,
  selecting before directory expansion or file activation. File single-click behavior still obeys
  `openFilesWithSingleClick`.
- **Current directory is stable.** `onlyPreviewTree.service.ts:12-26` derives it from a selected
  directory, a selected tree file's parent, the Preview file's parent, then root. Roving focus is
  separate. Workspace restore/external selection, Locate, file selection, and directory reveal
  synchronize tree state; workspace replacement resets it. Global Search captures the derived
  value once on entry and does not recapture it from later focus movement.
- **Files is always Project; Contents alone is scoped.** The selected-file priority lane produces
  filename matches before its scope check and fences only Contents
  (`selected-file-priority-lane.mjs:168-193`). The authoritative Files query explicitly passes
  `{ kind: 'project' }`, while SQLite Contents receives the validated request scope
  (`global-search-executor.mjs:175-196`). Tests prove an out-of-directory `network` name remains in
  Files while Contents stays under Current directory until switched to Project.
- **Directories never enter SQLite.** Traversal publishes directory records only through the
  candidate tree callback/array; its SQLite entry stream yields regular files. The scoped early path
  also disables tree collection. Directory-name matching therefore performs no file-body read and
  creates no directory FTS row.

## Plain native SQLite boundary

- `src/preload/onlypreview/search/core/sqlite-index.mjs:1-4,106-108` imports `DatabaseSync` directly
  from `node:sqlite` and opens the supplied path directly. Candidate backup likewise imports
  `backup` from `node:sqlite` in `search-engine.mjs:1-7`.
- The file-search bootstrap derives its disposable search-index path directly under user data; the
  runtime/coordinator passes that capability-scoped path to the engine. No Core database wrapper,
  Keychain lookup, credential, or encryption adapter is in this route.
- Static search across the file-search sources, `package.json`, and `yarn.lock` found no SQLCipher,
  `PRAGMA key`, cipher pragma, or cipher dependency. `sqlite-schema.mjs` contains only ordinary
  SQLite tuning/schema pragmas. The source-integration regression freezes this plaintext
  `node:sqlite` contract.

## Verification

| Command / evidence | Result |
| --- | --- |
| Task-listed Global Search engine/Shell/source/wiring Node tests | **PASS, 26/26** |
| `node --test tests/onlypreview/onlyPreviewSearchShell.test.mjs` | **PASS, 4/4** |
| Independent real first-build-promotion reproduction | **PASS:** Files contains `network`, Contents remains scoped, promoted token resolves |
| `node --check` for `search-engine.mjs` and `global-search-executor.mjs` | **PASS** |
| Plain-SQLite source/dependency audit | **PASS:** native `node:sqlite`; no SQLCipher/key/cipher/Core/Keychain route |
| `git diff --check` | **PASS** |
| Shared delivery run: `yarn typecheck:node` and `yarn build` | **PASS** |
| Electron / Playwright / E2E / real app | Not run, as required |

Two older, unmodified Search engine suites still assert the task-037-preceding merged
`response.results` shape and fail after reaching those stale assertions; the current grouped
contract returns `files` plus `contents`. This pre-existing test drift is outside task 038's change
set and does not contradict any reviewed runtime path or the 30 focused passing tests above.

## Conclusion

**PASS — Review 2's first-build/reusable-index false-empty Files race is closed, Review 1's writer
gate and bounded scoped traversal fixes remain intact, and the tree interaction, split search scopes,
token lifecycle, resource limits, and deliberately plaintext native SQLite boundary match the
accepted design.**

Task 038 is ready for Ral's live pointer, keyboard, search, and large-project acceptance.
