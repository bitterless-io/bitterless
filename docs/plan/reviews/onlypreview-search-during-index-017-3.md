---
id: onlypreview-search-during-index-017-3
status: pass
reviewed_task: onlypreview-search-during-index-017
target: working-tree-at-5b9030bda03d89f6e9fb4d90bc8da023548123ae
base: 5b9030bda03d89f6e9fb4d90bc8da023548123ae
date: 2026-08-11
review_type: independent-third-source-node-and-recorded-artifact-no-electron
---

# Verdict

**PASS — the third-round fixes satisfy the 017 contract, the current source has no blocking
regression, and the final build plus complete E2E report are current with the reviewed source.**

The hidden preload now waits until its document is the file-search target before registering its
capability-bound runtime handler. Main retries only the transport's null/unregistered readiness
result under one bounded deadline. Preload-owned searches use callback cancellation without
requiring a renderer `SharedArrayBuffer`. Watch commits refresh an accepted query without clearing
its displayed rows, and macOS rename hints distinguish a stable same-path file update from changes
that require a complete reconcile. The E2E fixture waits for the complete visible renderer graph,
and the acceptance source verifies the hidden owner/security/empty page and terminal cleanup
without returning capability or filesystem authority.

# Findings

- P0 blocking: none.
- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: the installed `electron-xpc` transport still exposes no disposal operation for
  dynamically capability-named Main/preload handler registrations. Every owner start creates fresh
  runtime/event names (`src/main/fileSearch/fileSearchWindow.service.ts:37-44` and
  `src/main/fileSearch/fileSearchRuntimeEvent.handler.ts:9-24`), while stop can detach the singleton
  relay and destroy its BrowserWindow but cannot remove those registry keys
  (`fileSearchWindow.service.ts:126-132`). This remains authorization-safe: detach removes the only
  active attachment and resolves pending relay work (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:177-183`),
  and a retained event handler cannot publish unless its capability exactly equals the current
  attachment (`fileSearchRuntimeRelay.service.ts:197-210`). The E2E cleanup also waits for zero exact
  file-search windows and webContents (`tests/onlypreview/specs/onlyPreviewSearch.spec.ts:389-431`).
  Repeated-open registry-size instrumentation remains useful transport hardening, not an 017
  delivery blocker.

# Third-Round Fix Audit

## Hidden preload registration and bounded readiness

The preload instantiates `XpcPreloadHandler` only when the document pathname is the file-search
entry. An initial `about:blank` therefore leaves `fileSearchRuntime` null and installs a one-shot
`DOMContentLoaded` retry; the handler is created only after the target document is present
(`src/preload/fileSearch/fileSearch.preload.ts:136-154`). Importing `electron-xpc/preload` creates
the generic emitter proxy, but does not register the private runtime handler; registration occurs
only in the guarded `new FileSearchRuntime()` path. Main independently admits only its exact
computed target URL, denies window creation, and converts an unexpected navigation/redirect into a
terminal lifecycle failure (`src/main/fileSearch/fileSearchWindow.service.ts:45-94`). The behavior
test begins at a non-target document, observes no private handler, then settles the target and
observes exactly the capability-derived handler
(`tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs:178-214`). The exact navigation fence also
has direct behavior coverage.

`waitForFileSearchRuntimeReady()` retries only `null`/`undefined`. It rejects an explicit `{ ok:
false }`, a stopped owner, an XPC rejection, or the single deadline; retry delays race the same stop
and timeout promises, so repeated null responses cannot extend the default 10-second bound
(`src/main/fileSearch/fileSearchRuntimeReady.service.ts:3-51`). Production rechecks window identity,
lifecycle generation, and destruction both before and after readiness, and startup failure stops
the owner (`fileSearchWindow.service.ts:96-123`). The focused behavior test covers null-then-ready,
explicit failure, and stop (`onlyPreviewSearchUtilityRpc.test.mjs:620-655`).

## Callback cancellation and latest-only single flight

The hidden coordinator now creates a plain `{ cancelled: false }` control and passes an
`isCancelled` callback into the engine; superseding or explicit request cancellation flips that
same control (`src/preload/fileSearch/fileSearchCoordinator.ts:67-108`). The existing latest-only
scheduler still rejects a displaced pending job, marks the active job superseded, cancels its
execution, and dispatches only the final trailing job after the active one drains
(`src/preload/onlypreview/search/core/single-flight.mjs:17-87`).

The engine prefers the callback and retains a guarded `SharedArrayBuffer` fallback solely for the
legacy core/worker callers. `typeof SharedArrayBuffer !== 'undefined'` protects environments where
that global is absent (`src/preload/onlypreview/search/core/search-engine.mjs:533-576`). The real
engine cancellation test proves the callback returns `CANCELLED`; the generic scheduler tests
continue to prove active-plus-latest and targeted cancellation behavior
(`tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs:277-303` and
`tests/onlypreview/onlyPreviewSearchEngine.contract.test.mjs:119-187`).

## Watch classification and Shell refresh fencing

The watch controller preserves rename-path context instead of treating every macOS `rename` hint
as an unconditional full refresh (`src/preload/onlypreview/search/core/watch-controller.mjs:26-28,77-116,128-137`).
The engine permits an incremental rename-hinted update only when that same relative path already
represented a regular file and still resolves canonically to a regular file. A new path, deleted
path, directory/symlink/type transition, containment discrepancy, actual old/new rename pair, or
other ambiguity upgrades to a full refresh before emitting the commit
(`src/preload/onlypreview/search/core/search-engine.mjs:670-776`). Behavioral coverage proves both
the stable same-path update and actual rename, while the neighboring CRUD, parent-kind, FIFO,
oversized-burst, and symlink tests cover the remaining full/incremental convergence cases
(`tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs:269-352,449-573,575-718`).

The Shell accepts a watch commit only after exact event-shape, host, workspace, generation, active
query, and captured-directory-scope checks. It advances the input generation, cancels stale work,
and schedules the new query without calling `clearResults`, so accepted rows remain visible during
the refresh (`src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts:62-98,133-149,392-421`).
The behavior test rejects wrong host/workspace/generation/scope and malformed events, retains the
old rows while pending, then replaces them only with the newly accepted response
(`tests/onlypreview/onlyPreviewSearchShell.test.mjs:751-814`). A committed revision also retries a
previously failed query (`onlyPreviewSearchShell.test.mjs:816-859`). Existing request/batch fences
still prevent stale request, workspace, or generation results from rendering.

## Fixture and E2E owner/security/cleanup

The shared fixture now polls one standalone window with the exact sorted `preview`,
`previewHeader`, and `shell` renderer-mode graph before handing the app to a test. It uses one
60-second poll and preserves the original error in the diagnostic failure rather than nesting a
second wait or swallowing evaluation failures
(`tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts:223-255`).

The search acceptance probe returns only owner counts/relationships, visibility/type, fixed
security booleans, and empty-page facts. It does not return a URL, preload path, additional
arguments, capability, instance id, workspace path, database path, or file body. It requires one
parentless hidden owner, `sandbox: false` only for the trusted preload, context isolation, disabled
page Node integration, web security, disabled background throttling, zero body children/text, and
no page-world `process`/`require`; it also rejects a stale UtilityProcess build artifact
(`tests/onlypreview/specs/onlyPreviewSearch.spec.ts:301-387`). Closing the standalone must reduce
the standalone, exact file-search window, and exact file-search webContents counts to zero
(`onlyPreviewSearch.spec.ts:389-431`). The current recorded complete E2E report contains this source
and passes the owner/search/cleanup scenario.

# Full Contract Regression Audit

- The official Vite graph contains `renderer/fileSearch/index.html` and `preload/fileSearch.js` and
  no OnlyPreview search UtilityProcess input. The built output has both new entries and no
  `out/main/onlypreviewSearchUtility.js`.
- Main still owns host/bootstrap/path resolution. The visible preloads and renderer bridges carry
  no private capability, search token, absolute root, or database path. Private request/response
  and event surfaces retain exact shape, host, workspace, generation, request, and capability
  validation before public broadcast.
- The active/candidate SQLite split remains atomic. Searches use only the complete active index;
  failed/cancelled/config-refresh candidates retain the old active database and clean temporary
  artifacts. First-build `In Directory` performs a complete same-policy scoped traversal, while
  first-build `In Project` waits for promotion. No SQL `LIKE` fallback was found.
- Browse remains demand-loaded and independent from the Search projection. It is not capped by the
  Search depth/result/index limits; hidden or config-excluded directories remain browsable even
  when they are not searchable.
- Counting/indexing lifecycle events do not cancel an accepted query or clear rows. Root/listing,
  snapshot, progress, batch, watch, workspace, selection, and generation fences remain intact.
- The 017 Path now includes the newly changed boundary regression test as well as the complete
  Main/preload/renderer/shared/Shell/build/test/doc surface
  (`docs/plan/tasks/onlypreview-search-during-index-017.md:23-53`). No 017 source, test, config, or
  contract path remains undeclared.

# Build and E2E Evidence Audit

The reviewed sources predate the existing official outputs: the latest runtime source timestamp is
12:48:48, `out/main/app.main.js` is 12:49:50, `out/preload/fileSearch.js` is 12:49:53, and the hidden
HTML output is 12:50:07. Read-only bundle inspection finds the deferred `DOMContentLoaded`
registration, guarded cancellation callback/SAB compatibility, bounded readiness code, and watch
event path in those outputs. `package.json` remains the unrelated owner profile
`Bitterless_DEBUG_PROD`; `yarn.lock` is unchanged; no temporary production probe or stale search
Utility artifact was found.

The durable Playwright HTML report and `.last-run.json` are timestamped 12:51:53, after the final
E2E source at 12:49:17. Parsing the report's embedded `report.json` gives **8/8 expected, 0
unexpected, 0 flaky, 0 skipped**: `onlyPreview.spec.ts` 5/5 and
`onlyPreviewSearch.spec.ts` 3/3. The reported search-only repeat result is **9/9**, but that repeat
run has no separate retained report after the complete run overwrote it; it is recorded here only
as developer-reported evidence, not as an independently audited artifact.

# Scope Audit

The working tree is cumulative. The owner profile change in `package.json` and the coin, trench,
and omni changes remain unrelated to 017 and were not modified. `yarn.lock` is unchanged. This
review adds only `docs/plan/reviews/onlypreview-search-during-index-017-3.md`; it does not modify
source, tests, configuration, task status, prior reviews, branches, commits, or remotes.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewSearchEngine.{sqlite,scope,recovery}.test.mjs tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | PASS — 45/45 |
| `node --test tests/onlypreview/*.test.mjs` | PASS — 164/164 |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS — `[check-renderer-i18n] ok` |
| Focused ESLint over all changed/new file-search and OnlyPreview TypeScript test/runtime files with `--quiet` | PASS — 0 errors |
| `git diff --check` | PASS before review creation |
| Existing official build output audit | PASS — current file-search Main/preload/renderer graph, no old search Utility entry |
| Existing complete Playwright HTML report audit | PASS — independently parsed 8/8; search repeat 9/9 remains reported-only |

Per verifier instructions, this review did not run `yarn build`, Electron, Playwright, E2E, or the
full application. It audited the current recorded build/E2E artifacts read-only.

# Conclusion

**pass**
