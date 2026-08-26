---
id: maestro-tab-loading-indicator-011
scope: Maestro browser per-tab page loading indicator and watchdog lifecycle
status: implemented; owner verification pending
depends-on: [maestro-cowork-menubar-parity-006]
verify: source audit and independent review only; Ral owns Electron/runtime visual acceptance
---

# Replace Maestro's global page progress bar with per-tab loading icons

## Objective

Match current Micromeet Cowork page-loading behavior: remove Maestro's simulated global progress
bar, render a loading icon in each loading tab's favicon slot, and guarantee that every loading
state settles through normal events, teardown, or a 30-second Main-process watchdog.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-global-page-load-progress.md`
- `docs/plan/tasks/maestro-cowork-menubar-parity-006.md`
- `../micromeet-cowork/docs/features/tab-loading-indicator.md` (upstream behavior reference)

## Path

- `src/main/maestro/windows/main/maestroBrowserView.service.ts`
- `src/shared/maestro/coach.api.ts`
- `src/renderer/maestro/home/src/components/MenuBar/{MenuBar.vue,MenuBar.less,menuBar.store.ts}`
- `scripts/maestro/check-debugger-toggle.mjs`
- `docs/features/maestro.md`
- `docs/issues/maestro-global-page-load-progress.md`
- `docs/plan/{README.md,tasks,reviews}/**`
- `docs/INDEX.md`

## Contract

- Add required, non-persisted `loading` to `TabInfo` and `loading` plus a watchdog handle to every
  Main-owned `OperationTab` construction path. Initial state is always settled.
- `setTabLoading(tab, loading)` is the lifecycle authority:
  - clear the previous watchdog first;
  - every `true` rearms a 30,000ms watchdog, even when the tab was already loading;
  - broadcast the tab list only when the visible boolean changes;
  - watchdog expiry sets the tab to settled, logs a value-free warning keyed by tab id, and
    broadcasts the changed tab list.
- Loading events belong to their view's owning tab and are never gated by `activeTabId`.
  `did-start-loading` sets; `did-stop-loading`, main-frame `did-fail-load`, and
  `render-process-gone` clear.
- Cooling/closing a view clears loading before ownership is detached. Reset clears every watchdog
  before discarding tabs. No timer may outlive its tab or Maestro window.
- Project `loading` through `tabInfo()`. Existing `tab.store.ts` remains a passive consumer of the
  authoritative `coach/tabs` snapshot.
- In the tab chip, `IconLoader2` replaces favicon/globe only while `tab.loading`. It occupies the
  same fixed 16px slot, is decorative, uses a BEM class, and respects reduced motion. The tab label,
  close control, compression, dragging, active styling, and Bitterless fixed-Home icon stay intact.
- Remove the full-width progress DOM and styles. Remove global progress state, interval/timeout
  logic, `LoadProgress`, and `coach/load-progress`; do not leave dead compatibility paths.
- Preserve navigation, HTTPS handling, page injection, debugger/capture, warm/cold tab behavior,
  persistence schema, fixed Home and AI-CRMS isolation, Workbench, i18n, and all unrelated dirty
  worktree changes.
- Update existing source guards whose bounded `tabInfo()` extraction used the deleted
  `broadcastLoading()` method as a structural anchor. Preserve each assertion's behavioral intent,
  including the existing browser-kind guard around live debugger attachment, and anchor to the
  current stable method boundary; do not restore a dead compatibility method.

## Verification

- Independent source review verifies all tab constructors, event set/clear paths, teardown/reset
  cleanup, the exact 30-second rearming watchdog, `TabInfo` projection, favicon-slot rendering,
  reduced-motion behavior, and complete removal of the global progress channel/state/DOM/CSS.
- Task-owned `git diff --check` and new-file trailing-whitespace inspection must pass.
- Do not run tests, type checks, lint, builds, Electron, Playwright/E2E, network, or packaged-app
  smoke in this delivery. Ral owns real-app acceptance.

## Delivery

- Implemented on 2026-08-26.
- Replaced the global simulated progress channel/state/DOM/CSS with transient loading state in the
  existing authoritative per-tab snapshot.
- Added owner-tab start/stop/failure/crash handling, teardown/reset cleanup, and an exactly
  30-second rearming Main watchdog that only settles the visual hint.
- Added the fixed 16px reduced-motion-aware loading icon in the favicon slot without changing tab
  geometry, Bitterless branding, Home DevTools, navigation, persistence, or capture behavior.
- Updated the maintained debugger source guard so its bounded `tabInfo()` extraction no longer
  depends on the deleted global-loading method while still verifying browser-only live attachment.
- Independent source review: [Review 3](../reviews/maestro-tab-loading-indicator-011-3.md) —
  Approved, no P0-P2 findings. Review 1/2 blockers are resolved.
- Ral owns Electron/runtime visual and E2E acceptance; intentionally not run in this delivery.
