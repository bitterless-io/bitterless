---
id: onlypreview-search-during-index-017-1
status: blocked
reviewed_task: onlypreview-search-during-index-017
target: working-tree-at-5b9030bda03d89f6e9fb4d90bc8da023548123ae
base: 5b9030bda03d89f6e9fb4d90bc8da023548123ae
date: 2026-08-11
review_type: independent-source-and-node-no-electron
---

# Verdict

**BLOCKED — the hidden-renderer/XPC graph is substantially present, but three product/acceptance
regressions and an incomplete task Path prevent acceptance.**

The current source does replace the OnlyPreview UtilityProcess build/runtime with one hidden
`fileSearch` BrowserWindow, capability-bound XPC in both directions, Main-private bootstrap
enrichment, exact navigation/security preferences, validated public relays, candidate SQLite
promotion, a complete first-build directory scan, and progress/search decoupling. However, a
reopened active index is destroyed when its startup candidate fails, a settled query can become
permanently `pending` after a later build event, and the retained Electron acceptance still requires
the deleted UtilityProcess instead of proving the hidden owner.

# Findings

## P2 blocking — startup candidate failure destroys the reusable active index

The engine recognizes a reusable SQLite index and installs it as the active query authority before
building the candidate (`src/preload/onlypreview/search/core/search-engine.mjs:299-302`). If that
candidate fails, the engine deliberately restores `state = 'ready'`, emits the active snapshot, and
keeps `this.index` (`search-engine.mjs:341-346`). The enclosing runtime then defeats that recovery:
every `coordinator.initialize()` rejection clears `this.active`, shuts the coordinator down, and
closes the retained index (`src/preload/fileSearch/fileSearchRuntime.ts:107-119`). Visible search
requests therefore have no active runtime after the exact reopen/reconcile failure for which the
engine preserved the old database.

This conflicts with the task's requirement that candidate failure leave the prior active index
queryable (`docs/plan/tasks/onlypreview-search-during-index-017.md:66-71,86-91`) and the accepted
feature contract (`docs/features/onlypreview.md:442-447`). The new recovery test exercises only
`engine.refresh()` after a successful initialize
(`tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs:112-181`), so it cannot detect the
runtime teardown.

**Required fix:** distinguish a superseded/fatal initialization from a failed candidate when the
coordinator still owns a complete active index. Preserve that runtime for later search (while still
reporting the failed build), and add a runtime-level reopen test that injects candidate failure and
then queries through `FileSearchRuntime`, not only directly through the engine.

## P2 blocking — build/root events can leave a completed search permanently busy

`resumeForAvailableRuntime()` always assigns `pending = true` and schedules a search whenever a
non-empty query has a browse context (`src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts:184-190`).
If that input generation already completed, `dispatchLatest()` exits because it equals
`lastDispatchedInputGeneration` (`onlyPreviewProjectSearch.store.ts:192-210`) and no branch clears
the newly assigned pending flag. Shell invokes this resume path both for a later ready snapshot and
for every accepted root listing (`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:549-578`).

This is reachable when a first-build `In Directory` query finishes while the project candidate is
still building, or when a completed query remains visible across refresh. The later ready/root event
leaves `aria-busy=true` and the visible “searching” status indefinitely
(`src/renderer/onlypreview/shell/src/components/ProjectSearchResults/ProjectSearchResults.vue:1-6,72-79`),
even though the accepted rows are already terminal. The current Shell test resumes only an input
that has never dispatched (`tests/onlypreview/onlyPreviewSearchShell.test.mjs:729-749`), and its
source assertion does not exercise the settled-generation case
(`onlyPreviewSearchShell.test.mjs:1223-1238`).

**Required fix:** resume only a genuinely undispatched/waiting input generation, or explicitly
leave `pending` false when the scheduler has no new generation to send. Add a behavioral test in
which a directory query completes, a root/ready build event arrives afterward, accepted results
remain intact, and `pending` remains false.

## P2 blocking — retained Electron acceptance still asserts the deleted UtilityProcess

The dormant Project Search E2E defines `expectSearchUtilityProcess()`, polls `app.getAppMetrics()`
for exactly one `node.mojom.NodeService` Utility process, and calls that assertion in the main search
scenario (`tests/onlypreview/specs/onlyPreviewSearch.spec.ts:250-284`). That is the opposite of the
017 acceptance requiring no OnlyPreview search UtilityProcess and exactly one hidden `fileSearch`
owner (`docs/plan/tasks/onlypreview-search-during-index-017.md:99-106`). If the E2E is run against
the new graph it either fails or accidentally treats an unrelated Node utility as the search owner;
it does not verify the hidden renderer, its URL/security preferences, or single-owner cleanup.

The focused “window integration” evidence cannot substitute for that acceptance: most graph checks
are source regular expressions (`tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs:116-195`),
and the preload/XPC test replaces `electron-xpc/preload` with a stub
(`tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs:26-62`). Neither drives an actual Electron
registration race, hidden window, crash, or close lifecycle.

**Required fix:** replace the Utility-process metric assertion with exact live evidence for one
hidden `fileSearch/index.html` webContents/window, absence of the old search UtilityProcess, and
cleanup after standalone close. Keep the security/ownership assertions capability-safe and do not
expose bootstrap paths or tokens to the test page.

## P2 blocking — the task Path does not describe the actual delivery surface

The declared Path ends at the focused source/tests/docs list
(`docs/plan/tasks/onlypreview-search-during-index-017.md:23-45`), but the current 017 work also adds
`src/shared/onlypreview/fileSearchRuntime.types.ts`, deletes
`src/main/onlypreview/onlyPreviewSearchUtilityLifecycle.service.ts` and
`src/main/onlypreview/onlyPreviewSearchUtilityRpc.service.ts`, updates
`tests/onlypreview/searchBootstrap.runtime.entry.ts` and
`docs/plan/analysis/onlypreview.md`, and must update the stale E2E file above. The shared-file line
currently names only the deleted `onlyPreviewSearchUtility.types.ts`; the two deleted Main services
are not covered by `src/main/fileSearch/`.

**Required fix:** add every actual 017 file/deletion to the task Path, including the E2E correction,
before delivery status is advanced. Do not absorb the unrelated package, coin, trench, or omni
working-tree changes.

## P3 non-blocking — dynamic XPC registrations are retired logically but never unregistered

Every start registers a fresh capability-named Main event handler and the hidden preload registers
fresh capability-named runtime methods (`src/main/fileSearch/fileSearchWindow.service.ts:66-73`;
`src/preload/fileSearch/fileSearch.preload.ts:137-143`). `stop()` detaches the current relay and
destroys the window but does not unregister either XPC name
(`fileSearchWindow.service.ts:149-155`). The installed `electron-xpc` registry overwrites/registers
exact names but exposes no corresponding Main unregister operation, so repeated standalone opens
retain dead renderer targets and old Main handler closures.

The current-capability check in `FileSearchRuntimeRelayService.publish()` means those stale names do
not authorize current events (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:197-209`), so
this is not a second live owner or a demonstrated bootstrap interception. It is still unbounded
lifecycle state and is not covered by the one-shot fence tests. Future hardening should add true
registration disposal (or a bounded stable mediator that preserves the random capability check)
and a repeated open/close regression.

# Contract Audit

- **Process graph and privilege:** Electron Vite now has top-level renderer and preload inputs and no
  OnlyPreview utility input (`electron.vite.config.ts:361-406,448-452`). The hidden page is empty with
  `default-src 'none'` (`src/renderer/fileSearch/index.html:1-12`). Its BrowserWindow uses `show:
  false`, `skipTaskbar`, `sandbox: false`, `contextIsolation: true`, `nodeIntegration: false`,
  `webSecurity: true`, `backgroundThrottling: false`, exact navigation fencing, and no new windows
  (`src/main/fileSearch/fileSearchWindow.service.ts:74-123`). The five visible views remain on their
  existing sandboxed preloads.
- **Private XPC/bootstrap:** Main generates a 256-bit capability, incorporates it into both dynamic
  handler names, and passes only it plus an instance UUID to the trusted preload. The bootstrap
  token stays in Main; Main resolves `{rootPath,databasePath}` and enriches only `initialize`
  (`fileSearchWindow.service.ts:66-73,88-91,134-140`;
  `src/main/xpc/onlyPreviewSearchRuntime.handler.ts:41-55`;
  `src/main/fileSearch/fileSearchRuntimeRelay.service.ts:128-169`). `electron-xpc` registration is
  exact-keyed and does not broadcast the capability name to visible renderers, so static review did
  not find a generic visible-renderer pre-registration/interception path.
- **Main validation:** request responses and snapshot/listing/progress/batch/watch events use exact
  shapes, current capability, host token, workspace, generation, directory/request IDs, normalized
  relative paths, and bounded result/watch arrays before Main binds `hostId` and broadcasts
  (`fileSearchRuntimeRelay.service.ts:128-175,197-249,272-620`). Unknown/stale public events are
  dropped. Main does no browse, content, SQLite, query, or watch I/O.
- **Candidate/search semantics:** queries read only `this.index`; candidate traversal writes a
  separate UUID SQLite path and promotion waits for active queries before closing/renaming/reopening
  (`search-engine.mjs:352-462,564-620`). First-build directory search creates an isolated in-memory
  index only after a complete same-policy scoped traversal, while first-build project search waits
  for the build/promotion (`search-engine.mjs:575-660`). There is no SQL `LIKE` path. Focused tests
  cover overlap, candidate invisibility/promotion, refresh failure/cancellation cleanup, hard/hidden
  exclusion, complete scoped content search, and project waiting, but not the blocking runtime and
  Shell sequences above.
- **Browse/search separation:** root and expanded listings continue through the independent browse
  index and are not capped by search traversal depth/exclusions. Search traversal retains the
  accepted depth-32, hidden-directory, fixed-directory, config, symlink, decoding, containment, and
  stable-order policy (`src/preload/onlypreview/search/core/traversal.mjs:48-79,111-333`;
  `src/preload/onlypreview/search/core/browse-index.mjs:50-241`).
- **Lifecycle:** load failure, invalid navigation/redirect, render exit, unresponsive, close,
  standalone teardown, auth teardown, and app quit all reach relay detach/window destruction in the
  inspected Main paths (`fileSearchWindow.service.ts:100-155`;
  `src/main/windows/onlyPreviewWindow.helper.ts:469-510,558-638`;
  `src/main/xpc/onlyPreview.handler.ts:342-350`;
  `src/main/app.main.ts:375-415`). Relay calls race the current stopped promise and reject publicly
  on detach (`fileSearchRuntimeRelay.service.ts:128-183`). Actual Electron lifecycle execution
  remains unverified in this review and the E2E contract is currently stale as described above.

# Scope Audit

The working tree is cumulative. `package.json` contains an owner runtime-profile change, and the
coin/trench/omni files and docs are unrelated to 017. This review neither attributes those changes
to 017 nor requests that they be reverted. The 017 implementation itself does not modify
`package.json` or `yarn.lock`.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewSearchEngine.{sqlite,scope,recovery}.test.mjs tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | PASS — 42/42 |
| `node --test tests/onlypreview/*.test.mjs` | PASS — 156/156 |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS — `[check-renderer-i18n] ok` |
| Focused ESLint over changed file-search/OnlyPreview TypeScript files | PASS at error level — 0 errors; 3 Prettier warnings in `fileSearchRuntimeRelay.service.ts` and `fileSearchRuntime.types.ts` |
| `git diff --check` | PASS before and after review creation |
| Existing build-output audit | `out/preload/fileSearch.js` and `out/renderer/fileSearch/index.html` exist, contain the current file-search runtime, and no `out/main/onlypreviewSearchUtility.js` exists |
| `yarn typecheck:web` (extra diagnostic, not in task Verification) | FAIL on broad pre-existing connector/home/poker/maestro/shared errors plus an unchanged OnlyPreview host-id typing line; no new 017-specific error isolated |

Per verifier instructions, `yarn build`, Electron, Playwright, full-app E2E, and the complete
application were not run. The output audit is consistent with a prior current-source build, but a
final recorded `yarn build` pass is still required after the blockers are fixed; existing artifacts
are not independent proof of the final repaired tree.

# Current Status

This review writes only
`docs/plan/reviews/onlypreview-search-during-index-017-1.md`. It does not modify source, tests,
configuration, task status, accepted feature/analysis documents, package files, unrelated owner
changes, branches, commits, or remotes.

# Conclusion

**blocked**
