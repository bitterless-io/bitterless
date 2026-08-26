# maestro-tab-loading-indicator-011 — Review 1

- Date: 2026-08-26
- Scope: independent source review of the current-worktree per-tab loading implementation, plus
  the tab persistence and existing Maestro source-check boundaries needed to verify that the old
  global loading path was removed without leaving a stale consumer.
- Method: task/design/upstream-reference inspection, task-scoped diff inspection, and exhaustive
  symbol/construction-path audit. Per the assigned contract, no tests, typecheck, lint, build,
  Electron, Playwright/E2E, network, or packaged-app smoke was run.

## Findings

### 1. P2 · blocking — the debugger source guard still anchors `tabInfo()` to the deleted global-loading method

- Design contract: `docs/plan/tasks/maestro-tab-loading-indicator-011.md:54-58` requires deletion of
  `broadcastLoading` / `coach/load-progress` without dead compatibility paths while preserving
  existing unrelated behavior.
- Code evidence:
  - `scripts/maestro/check-debugger-toggle.mjs:38-41` extracts `tabInfo()` with a regular expression
    whose closing anchor is the literal next method `private broadcastLoading`.
  - The implementation correctly replaces that method with `private setTabLoading` at
    `src/main/maestro/windows/main/maestroBrowserView.service.ts:1263-1284`; repository search finds
    `broadcastLoading` only in the stale check.
  - `scripts/maestro/check-maestro.mjs:8-23` discovers and executes every `check-*.mjs`, including
    this guard.
- Impact: `tabInfoMatch` is now necessarily `null`, so the existing debugger source guard exits
  with “browser view service should keep a bounded tabInfo broadcast mapper” before it can verify
  `debuggerAttached`. This is a deterministic regression in the maintained Maestro parity-check
  surface and a remaining compatibility reference to the deleted global progress implementation.
- Required correction: make the bounded `tabInfo()` extraction terminate independently of the
  removed method (or anchor it to the current stable boundary), while retaining the existing
  `debuggerAttached` assertion. No loading compatibility method should be restored.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Every Main-owned tab starts settled | `maestroBrowserView.service.ts:201-215`, `358-373`, `378-397`, and `994-1018` cover pinned Home, restored/cold browser, AI-CRMS, and claimed-spare browser construction; all initialize `loading: false` and `loadWatchdog: null`. Repository-wide `OperationTab` enumeration found no other constructor. | pass |
| Required `TabInfo.loading` is complete and transient | `coach.api.ts:584-604` makes `loading` required; `maestroBrowserView.service.ts:1027-1038` includes it in the only standalone `TabInfo` literal and `1246-1260` projects it from every tab snapshot. `tab.store.ts:119-129` persists only URL/title/favicon/position into `SavedTab`, whose schema at `tabs.api.ts:4-10` has no loading field. | pass |
| Start/stop belong to the owning view, not the active tab | `maestroBrowserView.service.ts:822-838` resolves `ownerOf(view)` for start, stop, main-frame failure, and renderer exit, with no `activeTabId` gate; subframe failures return without clearing. | pass |
| Cooling, closing, and reset cannot orphan a watchdog | `performCoolTab()` settles before clearing `tab.view` ownership (`694-712`); `performCloseTab()` settles before any awaited capture/view teardown (`1218-1225`); `reset()` clears every tab handle before closing views and discarding the array (`1398-1423`). | pass |
| Every start rearms an exact 30-second Main watchdog | `LOAD_WATCHDOG_MS = 30_000` at `maestroBrowserView.service.ts:56-59`; `setTabLoading()` clears the prior handle before every call, always creates a new timer for `true`, and suppresses a tab broadcast only when the visible boolean is unchanged (`1263-1284`). | pass |
| Timeout only settles the visual state | The watchdog callback at `maestroBrowserView.service.ts:1273-1279` nulls its own handle, changes only `tab.loading`, emits a warning containing the tab id but no URL/page value, and broadcasts the changed snapshot. It does not stop, reload, navigate, cool, or close the page. | pass |
| Old global progress path is absent from runtime source | `coach/load-progress`, `LoadProgress`, `broadcastLoading`, the renderer trickle interval/finish timeout, progress DOM, and task-specific progress CSS no longer occur under `src/`; `menuBar.store.ts` now consumes only `coach/nav`, `coach/tabs`, and navigation-state data. The stale source-check anchor reported above is the sole remaining code reference. | blocked by Finding 1 |
| Loader owns the unchanged 16px favicon slot | `MenuBar.vue:137-152` renders decorative `IconLoader2` only while `tab.loading`, otherwise preserving the Bitterless/page favicon and globe fallback branches. `MenuBar.less:62-64` fixes loader and favicon to 16px with `flex-shrink: 0`; tab label, close button, sizing, drag handlers, active styles, and the existing Bitterless asset mapping are unchanged. | pass |
| BEM and reduced motion | `.maestro-menu-bar__loading-icon` is a task-scoped BEM class; `MenuBar.less:203-211` supplies rotation and disables it under `prefers-reduced-motion` without hiding the glyph. | pass |
| Concurrent Home DevTools and branding work remains present | The same browser-view diff retains `shouldOpenPinnedHomeDevTools()` and its load/activation call sites; `MenuBar.vue:32-65` still maps fixed Home to `bitterless-icon.png`. Loading changes are additive around those dirty hunks and do not replace them. | pass |

## Verification

- Source/task/upstream contract review: completed.
- Exhaustive `OperationTab`, `TabInfo`, loading-writer/watchdog, old-channel, DOM, and CSS symbol
  inspection: completed.
- Tests, typecheck, lint, build, Electron, Playwright/E2E, network, and packaged-app smoke: **not
  run**, as explicitly required. Ral owns real-window loading and timeout acceptance.

## Conclusion

**BLOCKED — one P2 blocking finding.**

The runtime implementation otherwise satisfies the per-tab state, 30-second watchdog, teardown,
favicon-slot, branding, DevTools, persistence, and reduced-motion contracts. Delivery remains
blocked only because the maintained debugger source guard still depends on the deliberately
removed `broadcastLoading` method and will deterministically reject the new source shape.
