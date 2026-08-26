# maestro-tab-loading-indicator-011 — Review 3

- Date: 2026-08-26
- Scope: third independent review of the complete current-worktree per-tab loading delivery and
  the revised Review 1/2 source-guard fix.
- Method: task/design/source/diff inspection and exhaustive symbol/construction-path audit only.
  Per the assigned contract, no tests, scripts, typecheck, lint, build, Electron, Playwright/E2E,
  network, or packaged-app smoke was run.

## Findings

No P0-P2 findings.

The Review 1/2 blocker is resolved. No blocking or non-blocking task-scope defect was found in the
runtime loading lifecycle, renderer presentation, persistence boundary, or updated source guard.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Source guard has a real bounded `tabInfo()` slice | `scripts/maestro/check-debugger-toggle.mjs:38-42` locates the exact `tabInfo()` declaration, asserts it exists, locates the later `setTabLoading` declaration starting from that index, asserts the end follows the start, then slices only that bounded region. The index boundary naturally includes the intervening JSDoc at `maestroBrowserView.service.ts:1263-1266` without requiring method adjacency. | pass |
| Existing debugger projection assertion retains its behavior | `check-debugger-toggle.mjs:43-46` still asserts `debuggerAttached`, now matching the real browser-only projection exactly: `tab.kind === 'browser' && Boolean(tab.capture?.isAttached())` at `maestroBrowserView.service.ts:1258`. The unguarded `tabsOpenedThisTurn` literal at `1036` lies before `tabInfoStart` and cannot satisfy the bounded assertion accidentally. | pass |
| Dead compatibility method is not restored | The guard terminates at `private setTabLoading`; runtime/source search finds no `broadcastLoading`, `coach/load-progress`, or `LoadProgress` under `src/` or `scripts/maestro`. The task path and contract at `maestro-tab-loading-indicator-011.md:24-33,60-63` now explicitly include this source guard and preserve its behavioral intent. | pass |
| Every Main-owned tab starts settled | `maestroBrowserView.service.ts:201-215`, `358-373`, `378-397`, and `994-1018` cover pinned Home, restored/cold browser, AI-CRMS, and claimed-spare browser construction; all initialize `loading: false` and `loadWatchdog: null`. No additional `OperationTab` constructor exists. | pass |
| `TabInfo.loading` is complete and non-persisted | `coach.api.ts:584-604` requires `loading`; the standalone literal at `maestroBrowserView.service.ts:1027-1038` and shared mapper at `1246-1260` both project it. `tab.store.ts:119-129` persists only URL/title/favicon/position and `tabs.api.ts:4-10` has no loading field. | pass |
| Loading events update the owning tab without an active-tab gate | `maestroBrowserView.service.ts:822-838` resolves `ownerOf(view)` for start, stop, main-frame `did-fail-load`, and `render-process-gone`; only subframe failures are ignored, and none of these four paths checks `activeTabId`. | pass |
| View/tab/window teardown clears state and timers | `performCoolTab()` settles before clearing view ownership (`694-712`); `performCloseTab()` settles before awaited teardown (`1218-1225`); renderer exit clears at `835-838`; reset clears every watchdog before closing views and discarding tabs (`1398-1423`). | pass |
| Exact 30-second watchdog rearms and only settles visual state | `LOAD_WATCHDOG_MS` is `30_000`; `setTabLoading()` at `1267-1284` clears the previous handle before every call, creates a timer for every `true`, broadcasts only on boolean change, and on timeout only clears `tab.loading`, emits a tab-id-only warning, and broadcasts the settled snapshot. | pass |
| Global fake progress implementation is fully removed | `menuBar.store.ts` contains no global loading/progress state, interval, completion timeout, or load-progress subscription. The full-width progress DOM/CSS is absent, while unrelated update-download progress behavior remains intact. | pass |
| Loader preserves the favicon slot and interaction geometry | `MenuBar.vue:137-152` swaps decorative `IconLoader2` only while `tab.loading`, otherwise retaining the Bitterless/page favicon and globe fallback. `MenuBar.less:62-64,203-211` fixes the loader to the same 16px nonshrinking BEM slot and disables rotation under reduced motion. Labels, close controls, tab compression, dragging, active styles, 36px/48px chrome, Bitterless branding, and Home DevTools changes remain present. | pass |

## Verification

- Complete task/source/runtime re-review: completed.
- Review 1 and Review 2 blocker repair: completed and resolved by source inspection.
- Tests, scripts, typecheck, lint, build, Electron, Playwright/E2E, network, and packaged-app smoke:
  **not run**, as explicitly required. Ral owns real-window loading and timeout acceptance.

## Conclusion

**Approved — no P0-P2 findings.**

The global fake progress bar is replaced end to end by transient Main-owned per-tab loading state,
an exact 30-second watchdog, and a fixed-slot reduced-motion-aware loader. All ownership, failure,
teardown, persistence, branding, geometry, and concurrent Home DevTools boundaries remain intact,
and the previously stale debugger source guard now verifies its original browser-only projection
without depending on a deleted compatibility method.
