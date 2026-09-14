# Restored browser tabs wait before starting navigation

Status: implemented and code-verified, 2026-09-14; Ral's application testing pending.
The diagnosis below records the pre-change behavior.

## Approved implementation contract

Ral approved optimizing both BL and CoWork after discussing a per-page-instance
`navigationStarted` state. The implementation stays on each project's attached `dev/next` branch.

- Track whether the current WebContents has begun its intended navigation, in memory only.
  Do not persist this state or infer it from successful page loading. A restored/recreated
  browser view starts uninitiated. Internal blank-page prewarming does not count as navigation
  to the saved URL.
- The first activation of an uninitiated browser page with a URL initiates navigation once.
  Reserve that initiation before asynchronous work so repeated activation and `warmAndLoad`
  cannot issue duplicate loads. A warm view alone is not proof that its URL has been loaded.
- The full debugger attachment promise, recording-target switching, and current-document
  script evaluation must not block showing the tab or initiating its page. Preserve required
  first-request browser identity and document-start setup; do not reintroduce the previous
  identity race by dropping all preparation. Perform useful preparation during spare prewarming.
- Defer replacement-spare construction out of the current activation's critical path where
  practical. A cold-start target may still need its own view and required first-request setup.
- An in-flight or completed navigation is not repeated by switching tabs. A failed navigation
  remains initiated; retry/reload/address entry are explicit operations. Replacing the view
  starts a fresh lifecycle. A queued old load must not overwrite a newer typed URL or navigate
  a destroyed/closed/replaced view.
- Explicit address navigation, history selection, reload, and back/forward retain their
  behavior. Agent-controlled blank tabs used by `deep_fetch` remain genuinely blank until
  that caller has installed its navigation guards and initiates loading itself.
- Preserve pinned home, composite mini-apps, session/profile boundaries, history persistence,
  and current loading/error UI. No renderer or SQLite migration is required.
- Verify actual production code paths using non-GUI tests: pending debugger setup, cold/warm
  uninitiated activation, repeated activation, failed load, view replacement, superseding
  navigation, and controlled blank ownership. Run relevant code checks; Ral owns Electron E2E.

CoWork already dispatches navigation independently of debugger attachment. Its improvement
is explicit per-view navigation initiation and removing avoidable spare-construction work,
not a claim that it had BL's three-second gate.

## Report

Ral opened website A, quit the app, relaunched it, and selected the restored A tab.
The page only started loading after a noticeable delay; creating a new tab and entering the
same URL was faster. This investigation compares the attached Bitterless and CoWork source.

## Finding

Bitterless has an extra pre-navigation dependency on the complete debugger attachment promise
when activating a restored cold tab. If attachment remains pending, its 3000 ms fallback must
expire before `loadURL` is even called. The address-bar navigation path has no such dependency.
This explains an approximately three-second pause before loading starts, independently of the
website's response time. The wait is conditional: an already-settled attachment adds no delay.

Relevant Bitterless source, relative to the project root:

| Stage | Source | Behavior |
| --- | --- | --- |
| Restore metadata | `src/renderer/maestro/home/src/components/MenuBar/tab.store.ts:135`, `src/main/maestro/windows/main/maestroBrowserView.service.ts:1157` | Read saved tabs, then create browser entries through `addTab`; their `view` is null. |
| Create/claim a view | `maestroBrowserView.service.ts:1032` | `ensureWarm` claims a spare or builds a view and retains its `capture.attach()` promise. |
| Supposed prewarming | `maestroBrowserView.service.ts:693`, `:1018` | Constructs a hidden WebContentsView and starts capture attachment; never navigates it, even to `about:blank`. A spare is available before attachment has completed. |
| Activate restored page | `maestroBrowserView.service.ts:2051` | `awaitAttach(tab.attachReady).then(() => wc.loadURL(tab.url))`. |
| Timeout | `maestroBrowserView.service.ts:73`, `:126` | Race full attachment against a 3000 ms timer; the timer starts on activation, not during spare creation. |
| New tab, typed address | `maestroBrowserView.service.ts:1850`, `:534` | `newTab` claims an already-present view; subsequent `navigate` directly calls `loadURL` at line 561. |

The delay is before navigation initiation, not a wait for the returned `loadURL` promise to
finish. Electron documents that the promise settles after page loading succeeds or fails:
[webContents.loadURL](https://www.electronjs.org/docs/latest/api/web-contents#contentsloadurlurl-options).

## Why attachment can depend on navigation

`src/main/maestro/capture/debuggerCapture.ts:308` awaits a sequence of CDP commands:
`Network.enable`, optional Fetch configuration, the UA override, `Page.enable`, document-start
script registration, and `Runtime.evaluate` against the current document. The full promise
therefore covers more than the configuration needed before the first remote request.

The fresh view has never navigated. Waiting for renderer/document-dependent CDP work before
performing its first navigation introduces a dependency cycle when those commands cannot finish
until that navigation creates the target. The outer three-second timeout breaks the cycle by
finally starting the page. Leaving the app open longer does not consume that timer: it is
created only when the restored tab is activated.

This trigger is supported by CoWork's existing historical diagnosis
[`tab-crash-destroyed-desync.md`](../../../micromeet-cowork/docs/issues/tab-crash-destroyed-desync.md)
and its bootstrap comments at `apps/cowork/src/main/modules/window-manager/windows/main/mainWindow.controller.ts:523`.
Those describe CDP commands hanging on never-navigated views. The exact CDP command stalled in
Ral's current running app has **not** been captured; the controlled probe injects that condition
and proves its effect on navigation, rather than measuring Electron renderer startup.

## Scope and exclusions

- CoWork's ordinary restored tabs do not await debugger attachment. Its `viewSlot.service.ts:138`
  starts capture in the background, and `browser.controller.ts:1584` calls `loadURL` directly.
  Its pinned-home bootstrap has a separate eight-second attachment fallback; that is not on
  the ordinary restored browser-tab activation path. Do not attribute this BL cause to CoWork.
- BL's normal, non-recording `capture.service.ts:372` returns immediately from
  `switchCaptureTarget`. Recording can introduce an additional wait there, but it is not the
  ordinary restart scenario (`capturing` initializes false).
- Saved-tab SQLite reads precede creation of the restored tab strip. Browser-history writes
  occur after successful navigation and run without awaiting them (`browserHistoryRecorder.ts`).
  Neither appears in this post-click, pre-`loadURL` wait.
- Loading UI starts on `did-start-loading` (`maestroBrowserView.service.ts:1226`). Before the
  delayed `loadURL`, the tab still has `loading: false`, making this pause look unresponsive.
- The attachment gate predates the browser-history work: Git identifies commit `14b22d5`
  (2026-07-30) as its introduction. It was originally intended to apply the browser identity
  before the first request; see [the identity issue](browser-identity-inconsistent-across-embedded-views.md).
- A duration substantially beyond three seconds needs additional evidence: synchronous view
  construction, event-loop contention, recording work, and network loading are not measured here.

## Recommended repair

Unify the restored-tab and address-entry navigation setup. Make spare prewarming initialize a
real blank document; separate the required pre-navigation identity/script registration from
current-document injection, which should not hold the first navigation. Preserve the first
request's existing identity contract. Simply deleting the gate would remove the wait but revive
the identity race it originally addressed. The approved contract above governs the repair.

## Verification

Non-GUI probes execute TypeScript methods extracted from the current source, with Electron/CDP,
layout, and transport boundaries mocked. They distinguish `activateTab` returning from the
actual call to `loadURL`. Results and source hashes are retained in the overmind scratch directory
`tmp/restored-tab-load-diagnosis/`. No Electron app, live website, database, or E2E suite was launched.

BL probe: `node tmp/restored-tab-load-diagnosis/probe.mjs`, run from the overmind root.
It extracts the actual view factory, activation, navigation and `DebuggerCapture.attach` methods.
Results in `results.json`:

| Controlled condition | Time until `loadURL` invocation |
| --- | --- |
| Restored cold tab, injected pending `Runtime.evaluate` | 3002.568 ms |
| New blank tab then typed navigation, same pending condition | 0.726 ms |
| Restored cold tab, attachment commands immediately resolve | 0.358 ms |
| Restored cold tab, injected pending command released after 120 ms | 121.512 ms |

In the first case `activateTab` returned at 1.519 ms, although navigation had not started.
These are source-probe timings, not measured application or website performance. The pending
command is injected, not a claim that `Runtime.evaluate` is the particular command stalled in
Ral's app. Boundary mocks and source SHA-256 hashes are included in the results.

CoWork probe: `node tmp/cowork-restored-tab-load-probe.cjs`. Both a claimed spare and a newly
created view call `loadURL` even when capture attachment and target switching never settle.
Output and source hashes are retained alongside the BL results as `cowork-probe.log` and
`cowork-sources.json`.

## Implementation

The page instance now carries non-persisted navigation initiation and request state. All app-owned
first/explicit loads share `startTabNavigation`, which reserves initiation before preparation,
starts the loading indicator immediately and fences completion by view, lifecycle and request.
Repeated activation shares the pending attempt. A newer address, view replacement or close
invalidates the older queued request. A failure does not automatically retry on a tab switch.

`prepareBrowserDocument` starts a real blank document for browser views. Its initialization
events are isolated from the saved tab's address/title and actual target loading state.
`DebuggerCapture.prepareNavigation` waits only for required Network/Fetch, UA and document-start
script registration. `attach` can continue its current-document `Runtime.evaluate` independently;
that promise no longer gates navigation. Replacement-spare creation is deferred, and recording
target switching no longer blocks first loading. Controlled blank tabs retain caller-owned
navigation so their guards are installed before they load any remote URL.

This removes the old unconditional dependency on full attachment with a three-second fallback;
it does not claim that creating a cold renderer and applying required first-request settings
takes zero time. Blank-document initialization and required CDP preparation each have a
five-second failure deadline, not a fixed sleep. An error settles loading, records a load
failure in existing trace/agent state and permits explicit Reload/address retry;
it does not send an unconfigured first request as the old timeout fallback did.

## Final code verification

- 95/95 related tests passed, including 11 new first-navigation tests and 13 new capture
  preparation tests. The remaining 71 cover history, agent navigation and composite tabs.
  Command: `node --test tests/maestro/maestroBrowserHistory*.test.mjs tests/maestro/maestroCompositeTabNavigation.test.mjs tests/maestro/maestroCompositeTabInstances.test.mjs tests/maestro/maestroAgentBrowserSession.test.mjs tests/maestro/maestroFirstNavigation.test.mjs tests/maestro/maestroCaptureNavigationReady.test.mjs`.
- `yarn build`: passed. No Electron GUI or E2E was launched.
- Main/shared typechecks retain the same 64/3 pre-existing diagnostics; zero new diagnostic
  identities against the source snapshot taken before this implementation. Underlying `tsc`
  exits 2 for those existing errors; this is not a clean whole-project typecheck.
- The new-tab-focus guard passed. The debugger-toggle guard still fails its pre-existing
  MenuBar icon assertion; the relevant UI source is byte-identical to the pre-change snapshot.
- Final logs: overmind `tmp/restored-tab-load-implementation-baseline/`.
  Implementation stays in the original attached `dev/next` working tree; no commit or push.

Human check: open A/B, leave B active, quit/relaunch and select restored A; confirm prompt loading.
Click A repeatedly and switch A/B while loading; confirm one navigation and preserved page state.
Immediately replace A's address with another URL; confirm the old A does not return. Switch away
from a failed URL and back; confirm no automatic retry, while Reload/new address still work.
