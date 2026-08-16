---
id: onlypreview-search-during-index-017-2
status: pass
reviewed_task: onlypreview-search-during-index-017
target: working-tree-at-5b9030bda03d89f6e9fb4d90bc8da023548123ae
base: 5b9030bda03d89f6e9fb4d90bc8da023548123ae
date: 2026-08-11
review_type: independent-second-source-and-node-no-electron
---

# Verdict

**PASS — all four prior P2 blocking findings are closed, and the second full-contract audit found no
new blocking regression.**

Startup candidate failure now reports the failed initialization while retaining the current
complete index for later searches; fatal and superseded generations still clean their coordinators.
A completed Project Search generation is no longer revived as pending by later root/ready events.
The Electron acceptance source now inspects one exact hidden `fileSearch` owner and its teardown
instead of a UtilityProcess, and the task Path declares the complete 017 delivery surface.

# Findings

- P0 blocking: none.
- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: dynamically capability-named XPC registrations still have no disposal API in
  the installed transport. Each start registers new runtime/event names
  (`src/main/fileSearch/fileSearchWindow.service.ts:66-73`), while stop detaches the live relay and
  destroys the current window but cannot remove registry entries
  (`fileSearchWindow.service.ts:149-155`). This does not leave a live owner or authorization path:
  the old renderer/webContents is destroyed, the singleton relay has no active attachment after
  stop, and every event through a retained Main handler is checked against the *current* active
  capability before broadcast (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:177-209`).
  The repaired E2E contract also waits for zero exact file-search windows and webContents after
  standalone close (`tests/onlypreview/specs/onlyPreviewSearch.spec.ts:358-400`). Repeated
  open/close registry-size instrumentation remains useful future hardening, not a delivery blocker.

# Prior Blocking Closure

## Startup candidate failure preserves the reusable active index

The engine still opens a reusable database as `this.index` before its candidate build
(`src/preload/onlypreview/search/core/search-engine.mjs:299-302`) and, on candidate failure, restores
the ready state and emits the complete active snapshot without closing that index
(`search-engine.mjs:341-349`). It now exposes a strict workspace/generation/ready/index probe
(`search-engine.mjs:872-878`) through the coordinator
(`src/preload/fileSearch/fileSearchCoordinator.ts:28-40,102-119`).

`FileSearchRuntime.initialize()` uses that probe only after initialization rejects. It retains the
coordinator only when the same session is still current and the coordinator confirms a complete
active search index; otherwise it clears the active runtime and shuts the coordinator down
(`src/preload/fileSearch/fileSearchRuntime.ts:95-145`). The original rejection still becomes the
normal typed failure envelope, but a later same-host/workspace/generation search uses the retained
coordinator (`fileSearchRuntime.ts:54-62,171-178`). Main's relay accepts only the exact bounded
failure envelope and keeps its already-bound workspace/generation fences for that later request
(`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:143-170,272-315`).

The new runtime behavior test proves the sequence rather than asserting source text: initialize
returns `ok: false`, shutdown has not run, a subsequent Project search returns the retained result,
and final disposal shuts down exactly once
(`tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs:207-240`). A companion test makes the
active-index probe fail to prove fatal cleanup, then overlaps two initializations to prove a
superseded coordinator is shut down while the newer generation remains searchable
(`onlyPreviewSearchUtilityRpc.test.mjs:242-324`). The engine-level recovery test independently
retains the real SQLite index and removes failed/cancelled candidate artifacts
(`tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs:112-181`).

The public failure/search behavior is internally consistent. Root browsing is published before the
candidate build, and a failed candidate publishes a ready snapshot from the retained index. Shell
derives Project Search availability from the independent browse projection, accepts the root
listing, and resumes only an undispatched query (`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:196-210,549-578`).
The failure may remain visible as an index error, but it no longer makes the active search authority
unreachable.

## Settled root/ready events cannot revive pending state

`resumeForAvailableRuntime()` now checks
`inputGeneration === lastDispatchedInputGeneration` before assigning `pending` or invoking the
scheduler (`src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts:184-197`). The
normal dispatch/finally path still retains accepted rows and leaves pending true only when a newer
input generation exists (`onlyPreviewProjectSearch.store.ts:199-277`).

The added behavioral test completes a real store dispatch, retains its accepted result, sends two
later resumes corresponding to root/ready availability, and proves no new schedule/call and
`pending === false` (`tests/onlypreview/onlyPreviewSearchShell.test.mjs:751-774`). The preceding
test still proves that a genuinely undispatched query waiting for browse readiness is scheduled
when the runtime becomes available (`onlyPreviewSearchShell.test.mjs:729-749`).

## E2E now proves the hidden owner and cleanup without leaking authority

The stale UtilityProcess-metrics assertion is gone. The replacement Main-side probe identifies only
an exact `/fileSearch/index.html` target, requires one matching `BrowserWindow` and one matching
webContents, checks hidden/parentless/window ownership, validates the complete security preference
set and trusted preload, and inspects the page world for an empty DOM with no Node globals
(`tests/onlypreview/specs/onlyPreviewSearch.spec.ts:250-355`). It also rejects a stale built
`out/main/onlypreviewSearchUtility.js` entry (`onlyPreviewSearch.spec.ts:319-329`).

The probe reads `additionalArguments` only inside Main and returns the boolean
`privateArgumentsValid`; it never returns the capability, instance identifier, target URL,
preload path, workspace root, database path, or file content to a visible page or test result
(`onlyPreviewSearch.spec.ts:268-315`). The scenario invokes that owner assertion while the
standalone is alive and explicitly closes the standalone at the end, then waits for the standalone,
exact file-search window, and exact file-search webContents counts all to reach zero
(`onlyPreviewSearch.spec.ts:403-414,470-482`).

## The task Path now covers the complete delivery surface

The Path now includes the added shared runtime contract, both deleted Main Utility services, the
runtime test entry, delivery analysis, and the corrected Electron E2E spec, in addition to the new
Main/preload/renderer directories, core, Shell, build, logging, and focused tests
(`docs/plan/tasks/onlypreview-search-during-index-017.md:23-51`). The current 017 diff contains no
undeclared source/test/config path after excluding the explicitly unrelated package and
coin/trench/omni work.

# Full Contract Regression Audit

- The official graph inputs contain the top-level `fileSearch` preload and renderer and no search
  UtilityProcess Main entry (`electron.vite.config.ts:354-366,388-412,433-459`). The hidden page is
  empty with `default-src 'none'` (`src/renderer/fileSearch/index.html:1-12`), and the log policy
  recognizes its exact renderer entry.
- The hidden owner remains `show: false`, parentless, non-taskbar, `sandbox: false` only for the
  trusted Node preload, context-isolated, Node-disabled in the page world, web-security enabled,
  unthrottled, exact-navigation fenced, and unable to open windows
  (`src/main/fileSearch/fileSearchWindow.service.ts:74-123`). Readiness, load/navigation/render
  failure, unresponsive, close, standalone teardown, auth teardown, and quit all detach pending
  relay work and destroy the current owner through the inspected lifecycle graph.
- Runtime requests remain capability-bound in both directions. Main privately resolves the
  bootstrap and enriches only initialize; response/event validators enforce exact shapes plus
  host/workspace/generation/request/token bounds before public host binding. Visible preloads and
  renderer bridge state still contain no capability, absolute root, or database path.
- Queries still read only `this.index`; candidate build/promotion uses a private UUID database and
  waits for active readers before rename/reopen. Failure/cancellation removes candidate artifacts
  and config-refresh failure restores the previous config/policy/identity
  (`src/preload/onlypreview/search/core/search-engine.mjs:352-525`). First-build directory search
  performs a complete isolated same-policy traversal, while first-build project search waits for
  promotion (`search-engine.mjs:556-660`). No SQL `LIKE` fallback was found.
- Browse remains the independent complete demand-loaded metadata projection. Search still applies
  hidden/fixed/config pruning, non-recursed symlinks, containment, decoding, depth 32, stable order,
  and the 500-result cap without constraining root or expanded directory listings. Progress does
  not cancel or clear the active Project Search request/results, and all snapshot/listing/progress/
  batch/watch events retain host/workspace/generation/revision fences.

# Scope Audit

The working tree remains cumulative. The owner profile change in `package.json` and the coin,
trench, and omni files are unrelated to 017 and remain untouched. `yarn.lock` is unchanged. This
review adds only `docs/plan/reviews/onlypreview-search-during-index-017-2.md` and does not modify
source, tests, configuration, task status, the first review, branches, commits, or remotes.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewSearchEngine.{sqlite,scope,recovery}.test.mjs tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | PASS — 43/43 |
| `node --test tests/onlypreview/*.test.mjs` | PASS — 159/159, including the runtime retention/fatal/superseded tests |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS — `[check-renderer-i18n] ok` |
| Focused ESLint over all changed file-search/OnlyPreview TypeScript files, including the E2E source | PASS at error level — 0 errors; 5 Prettier warnings |
| `git diff --check` | PASS before and after review creation |
| Read-only output audit | `out/preload/fileSearch.js` and `out/renderer/fileSearch/index.html` exist; `out/main/onlypreviewSearchUtility.js` is absent |

Per verifier instructions, `yarn build`, Electron, Playwright, full-app E2E, and the complete
application were not run. The existing preload artifact predates the repaired runtime source, so
the read-only output audit is not claimed as proof of a final-source build. A final recorded
`yarn build` and execution of the updated Electron E2E remain delivery/release verification gates;
they do not reveal a source-contract blocker in this review's required no-build/no-Electron scope.

# Conclusion

**pass**
