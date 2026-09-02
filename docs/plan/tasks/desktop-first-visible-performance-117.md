---
id: desktop-first-visible-performance-117
scope: Restore near-instant first-visible startup for Maestro, Omni Browser, and OnlyPreview
status: implemented; owner packaged verification pending
depends-on: [maestro-open-diagnostics-113, omni-open-readiness-112, onlypreview-open-diagnostics-114]
verify: node --test tests/maestro/*.test.mjs tests/omni/*.test.mjs tests/onlypreview/onlyPreviewOpenDiagnostics.test.mjs tests/onlypreview/onlyPreviewDeferredIndex.test.mjs && yarn typecheck:node && yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false && node scripts/environment/runWithRuntimeProfile.cjs release_preview -- yarn _build:release && git diff --check
---

# Restore desktop first-visible performance

## Objective

Remove the packaged regression that keeps three native windows hidden while their local renderers
wait for Chromium scheduling, and restore a deterministic OnlyPreview Project tree after the window
opens.

## Packaged evidence

- Maestro cold boot reaches Shell/Home host mount in about 385ms, but waits 3.2 seconds for hidden
  Workbench and 4.3 seconds for pinned Home before showing. Failed optional readiness can hold the
  whole window for 30 seconds and destroy it.
- Omni restores its six native cells in 54--71ms, then waits while hidden. The first-party top and
  browser renderers do not execute for 18.3 seconds in one run and do not execute before the
  30-second timeout in another. Remote browser and Mini App navigation starts only after first
  visible and is not the bottleneck.
- OnlyPreview creates its hidden search runtime in about 200ms, but its attached hidden Shell waits
  10.4 seconds before the first renderer script executes. After mount, the only Project-index
  kickoff is a 750ms renderer timer; packaged logs show it was scheduled but never started, so no
  root listing was published and the directory stayed empty.

## Contract

### Shared first-visible boundary

- A native window becomes visible/focused once its BaseWindow/BrowserWindow, local Shell/chrome
  views, and initial bounds are safely attached. Local renderer load/mount acknowledgements remain
  measured, but cannot be waited on while the native host is hidden.
- Showing early must not create another graph, weaken generation/capability fencing, start duplicate
  navigation, or bypass the existing shared in-flight Open operation.
- Privacy-safe stage records retain native graph, first-visible, renderer script/import/mount,
  interactive, background startup, timeout, failure, and terminal timings.

### Maestro

- Cold Open becomes visible after the primary Maestro Shell/Home host is mounted. Hidden Workbench,
  pinned Home/startup-tab completion, spare-view prewarm, and other non-visible work continue without
  holding first-visible or destroying an already usable primary window on optional failure.
- The fixed Home route must not preload Settings-only Monaco/editor bundles. Settings and its heavy
  panels load only when navigated to.
- Existing close-to-hide reuse, authentication teardown, quit cleanup, and concurrent boot joining
  remain unchanged.

### Omni Browser

- Show/focus the native Omni graph immediately after restore and view attachment, before awaiting
  top/browser chrome load and Vue mount. Keeping the existing readiness promise after show is
  allowed so the Open button and concurrent callers still join until the visible browser is usable.
- Remote browser/Mini App navigation and nonessential Control startup remain after the visible/local
  chrome boundary and stay generation-cancelable.

### OnlyPreview

- Show the standalone native graph immediately after attaching and bounding its Shell, before
  awaiting Shell `loadFile`/Vue mount. Project reconciliation never gates first-visible.
- Restoring a Project dispatches search-runtime initialization deterministically after Shell setup;
  its root browse listing may populate progressively before full reconciliation. A renderer timer
  that can be suppressed by background throttling cannot be the only initialization path.
- Manual refresh and workspace replacement retain their single-current-index behavior.

## Verification

- Source/pure regressions lock show-before-renderer-wait ordering for all three windows and preserve
  shared in-flight/generation cleanup semantics.
- A renderer-store regression proves restored OnlyPreview Project initialization is dispatched
  without depending on `setTimeout`, and root-listing projection remains progressive.
- A build/source regression proves Maestro local Home no longer statically preloads the Settings
  Monaco path.
- Run focused tests, Node and directed renderer type checks, a Preview-profile production build, and
  `git diff --check`.
- Do not launch Electron, Playwright/E2E, a packaged smoke run, or the real app. Ral owns live
  acceptance.

## Owner verification

- In the next Preview package, cold-open each surface and confirm the native window appears close to
  the native-graph timing, then inspect correlated logs for renderer and background completion.
- Confirm OnlyPreview publishes the restored Project directory before full reconciliation ends.
- Rapidly click Omni Open twice and confirm one graph, one eventual success response, and a usable
  address field.

## Delivery

- Maestro now shows after Shell/Home host mount. Control, pinned Home/startup navigation, delayed
  Workbench creation, and spare prewarm settle through a separately observed background promise;
  rejection is diagnosed without destroying the primary window. Local Home/Workbench Settings and
  each Settings panel are lazy, keeping System Prompt's Monaco out of startup chunks.
- Omni shows/focuses immediately after restored native views are attached, then retains the same
  single-flight top/browser load and mount gate for Open feedback. Cold readiness completion cannot
  focus the window a second time; deferred content and Control remain generation-owned.
- OnlyPreview shows immediately after Shell attachment/bounds. Restored Project indexing moves from
  a throttled 750ms renderer timer to a cancelable microtask, so the existing early root listing can
  populate the directory before full reconciliation. Renderer receipt no longer steals focus.
- Focused tests passed Maestro 16/16, Omni 55/55, and OnlyPreview 28/28. Node/Web type checks,
  Maestro CLI integration, the final Preview-profile production build, and `git diff --check`
  passed. Electron/E2E and packaged runtime were not run.
- [Independent review 1](../reviews/desktop-first-visible-performance-117-1.md) passed after its P1
  focus-restoration and P2 background-diagnostic findings were fixed; no P0--P3 remained.
