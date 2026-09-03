---
id: omni-open-readiness-112
scope: Omni Browser single-flight readiness, Open feedback, and single Enter navigation
status: implemented; Preview 0.0.86 rebuilt; owner runtime verification pending
depends-on: [omni-miniapp-cells-001]
verify: node --test tests/omni/*.test.mjs && yarn typecheck:node && yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false && git diff --check
---

# Make Omni Open wait for a usable browser

## Objective

Prevent repeat Open from focusing a half-created Omni graph, keep both Mini Apps buttons pending
until the browser is actually visible, and remove the duplicate Enter navigation race.

## Context

- `docs/features/omni-miniapp-cells.md`
- `docs/issues/omni-open-readiness-and-double-navigation.md`

## Path

- `src/main/xpc/omniWindow.handler.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/renderer/home/src/views/miniApp/`
- `src/renderer/maestro/workbench/src/views/WorkbenchAppsView.vue`
- `src/renderer/omni/omniCell/src/App.vue`
- `tests/omni/`
- relevant renderer i18n resources

## Contract

- Main owns one creation/readiness promise. Concurrent calls join it even after `baseWindow` has
  been assigned; no caller succeeds from an `isCreating` or half-created-window branch.
- Creation resolves only after the top MenuBar and every initial browser-cell MenuBar have loaded,
  the native window has been shown, and focus has been requested.
- Bound readiness with one fixed timeout. Failure rejects every joined caller and tears down only
  the incomplete Omni graph through its existing cleanup path.
- A live ready singleton remains an immediate focus path.
- Home and Workbench reuse their existing per-card loading/disabled state, show one localized
  success message after the awaited Main response, and retain the existing localized failure path.
- Preserve the current Arco/Royal Blue visuals, spacing, and card geometry; add no new animation or
  decorative state.
- The browser address field has exactly one Enter event source and one `navigateCell` dispatch.
- Add fixed lifecycle diagnostics for the top, initial browser chrome, and Control first-party
  renderers: create/load start, DOM ready, load success/failure, unresponsive/process exit, and
  renderer script/language/import/mount. Do not record URL, cell identity, ready token, or raw error.
- On readiness timeout, report bounded pending counts for top/browser load and mount. Diagnostics
  must not add a new wait, relax readiness, or change the 30-second cleanup behavior.

## Verification

- Add/extend non-Electron tests for shared in-flight readiness, ready-before-response, timeout/fail,
  existing singleton focus, single Enter dispatch, and both renderer feedback paths.
- Run focused Omni tests, Node and directed renderer type checks, and `git diff --check`.
- Source/pure regressions cover lifecycle stage allowlists and timeout pending summaries.
- Do not launch Electron, Playwright/E2E, packaged smoke, or the real app. Ral owns live acceptance.

## Owner verification

- In a packaged Preview build, click Omni Open twice rapidly. Confirm one window appears, the button
  remains loading until it is visible, and an opened message appears before the button resets.
- Search from the initial browser cell and confirm one Enter causes one navigation and remains usable.
- Close/reopen an already ready Omni window and confirm the focus path is immediate.

## Delivery

- Added a pure single-flight coordinator with generation fencing, one 30-second deadline, exact
  invalidation cleanup, and a ready-singleton focus path.
- Added capability-fenced top/browser-cell mount acknowledgements after language init, dynamic
  import, Vue mount, and `nextTick`; remote browser content retains its separate unprivileged
  preload.
- Added localized Home/Workbench opened feedback and preserved loading through the Main result.
- Removed the duplicate raw Enter handler.
- Deferred/fake-timer regressions cover concurrent callers, readiness ordering, timeout/failure,
  cleanup, ready reuse, and old-generation restore completion during immediate retry.
- Focused tests passed 10/10; Node/Renderer type checks and `git diff --check` passed.
  Electron/E2E, packaged smoke, and the real app were not run.
- [Independent review 1](../reviews/omni-open-readiness-112-1.md) passed with no P0-P3 finding.

## Preview 0.0.86 follow-up

- Main restored six cells and waited for one browser chrome, then timed out at 29,997ms without any
  top/cell ready receipt. The Control renderer mounted only about 89.5 seconds after creation.
- Reopen develop/verify to add enough fixed lifecycle evidence to separate hidden WebContentsView
  scheduling, renderer navigation/load, module evaluation, language, App import, and Vue mount.
- Keep the current single-flight/readiness behavior unchanged until that package evidence identifies
  the performance fix.

## Near-instant open follow-up

The same packaged run plus process sampling showed the hidden local Omni renderers at background
priority, while Omni also created/restored six cells and their remote content in one startup burst.
Ral now requires a near-one-second visible and searchable first surface.

- Disable background throttling for first-party top MenuBar, browser-cell chrome, and Control
  renderers; do not weaken sandbox/context-isolation boundaries.
- Make the native graph visible/focused once its initial layout and first-party chrome views are
  attached, before slow remote page navigation or nonessential Control initialization can hold the
  first paint.
- Defer nonessential Control startup and remote page navigation until the visible/searchable local
  chrome readiness boundary. Preserve every saved cell and layout; restoration may complete
  progressively and must remain generation-cancelable.
- Keep single-flight behavior and one Enter navigation. A concurrent Open joins/focuses the same
  graph and cannot create a second window.
- Retain fixed privacy-safe timings for first-visible/first-interactive, restored cell counts,
  deferred navigation start/terminal, Control startup, pending readiness categories, and failures.
  Never log URLs, cell IDs, tokens/capabilities, queries, page content, or raw errors.

## Near-instant open delivery

- Top and every initial browser-cell chrome renderer start locally unthrottled and retain the
  existing load + post-`nextTick` mount gate. Exact generation/token/role/current-view fences restore
  normal throttling and remove lifecycle listeners on success, failure, timeout, or cleanup.
- The native window is shown/focused and Open resolves before a generation-owned 16ms timer turn
  starts browser/mini-app content or nonessential Control. Same-generation reopen reuses the pending
  batch, while cleanup cancels it without running stale work.
- Every initial browser and mini-app content load records one privacy-safe scheduled/start/terminal
  timeline. Timers, WebContents listeners, and browser semaphore permits use exact-once cleanup;
  queued and active work cannot over-release into a replacement generation.
- Control starts after first-visible, reports Vue mount separately from async layout readiness, and
  has a non-gating 30-second diagnostic cleanup deadline. Manual Control remains lazily creatable.
- `[omni-open]` records cover native/restore/first-visible/interactive/ready, local renderer
  lifecycle/bootstrap, accepted/rejected receipts, deferred navigation, bounded pending counts, and
  terminal cause. Fixed runtime allowlists omit URL, cell identity, token/capability, query/content,
  path, and raw error values.
- Focused tests, Node typecheck, and directed Web typecheck passed. After resolving each concurrency
  finding, [independent review 2](../reviews/omni-open-readiness-112-2.md) passed with no P0-P2 and
  one non-blocking P3 coverage note.
- Rebuilt the notarized macOS ARM Preview `0.0.86` package. Codesign and stapler validation passed;
  Electron/E2E and packaged runtime launch were not run, so live latency remains owner verification.
