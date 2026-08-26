# maestro-tab-loading-indicator-011 — Review 2

- Date: 2026-08-26
- Scope: independent re-review of the Review 1 blocking fix and the complete current-worktree
  per-tab loading implementation.
- Method: source/task/diff inspection only. Per the assigned contract, no tests, scripts,
  typecheck, lint, build, Electron, Playwright/E2E, network, or packaged-app smoke was run.

## Findings

### 1. P2 · blocking — the replacement `setTabLoading` anchor still cannot match the actual source boundary

- Design contract: `docs/plan/tasks/maestro-tab-loading-indicator-011.md:54-58` requires complete
  removal of the old global loading path without breaking unrelated Maestro behavior. Review 1
  required the existing bounded `tabInfo()` source guard to remain functional without restoring
  `broadcastLoading`.
- Code evidence:
  - `scripts/maestro/check-debugger-toggle.mjs:38-40` now requires the closing brace of
    `tabInfo()` to be followed by exactly two newlines and then `private setTabLoading`.
  - The real boundary at
    `src/main/maestro/windows/main/maestroBrowserView.service.ts:1261-1267` contains a four-line
    JSDoc block between that closing brace and `private setTabLoading`.
  - The original assertion remains intact at `check-debugger-toggle.mjs:41-45`, but it cannot be
    reached with a non-null `tabInfoMatch` under the current source shape.
- Impact: replacing the method name alone does not repair the guard; the regular expression still
  necessarily returns `null`, so the maintained debugger source check still exits at its bounded
  mapper assertion. Review 1's deterministic P2 remains.
- Required correction: bound the extracted region from the `tabInfo()` declaration to the later
  `setTabLoading()` declaration while allowing the intervening JSDoc (for example, by slicing
  between the two method declaration indices), then retain the existing `debuggerAttached`
  assertion. Do not reintroduce `broadcastLoading` or `coach/load-progress`.

## Runtime re-review evidence

| Requirement | Evidence | Result |
|---|---|---|
| All tab construction and projection paths remain complete | `maestroBrowserView.service.ts:201-215`, `358-397`, and `994-1018` still initialize every pinned Home, cold/restored browser, AI-CRMS, and claimed-spare browser tab with `loading: false` / `loadWatchdog: null`; the standalone `TabInfo` literal at `1027-1038` and shared mapper at `1246-1260` still project `loading`. | pass |
| Loading remains transient | `tab.store.ts:119-129` still persists only URL/title/favicon/position and `tabs.api.ts:4-10` still has no loading field. | pass |
| Events remain owner-scoped and ungated | `maestroBrowserView.service.ts:822-838` still resolves the owning tab for start, stop, main-frame failure, and renderer exit without an `activeTabId` gate. | pass |
| Cool, close, crash, and reset cleanup remains complete | `performCoolTab()` clears before ownership detach (`694-712`), `performCloseTab()` clears before awaited teardown (`1218-1225`), renderer exit clears at `835-838`, and reset clears every watchdog before discarding tabs (`1398-1423`). | pass |
| Exact 30-second watchdog remains correctly rearmed | `LOAD_WATCHDOG_MS` remains `30_000`; `setTabLoading()` at `1267-1284` clears the prior handle first, rearms on every `true`, broadcasts only a visible boolean change, and lets timeout change only visual state plus a tab-id-only warning and tab snapshot. | pass |
| Old runtime progress path remains removed | Runtime search under `src/` still finds no `coach/load-progress`, `LoadProgress`, `broadcastLoading`, fake renderer trickle/finish methods, full-width progress DOM, or task-specific progress CSS. | pass |
| 16px slot, BEM, reduced motion, branding, and geometry remain intact | `MenuBar.vue:137-152` still swaps decorative `IconLoader2` into the favicon branch; `MenuBar.less:62-64,203-211` keeps the 16px nonshrinking BEM slot and reduced-motion stop. Label, close, drag/compression/active styles, Bitterless icon mapping, and Home DevTools hunks remain present. | pass |
| Review 1 source-guard finding is fixed | The method name changed, but the actual JSDoc-bearing boundary cannot satisfy the new expression. | **fail** |

## Verification

- Complete task/runtime source re-review: completed.
- Review 1 fix inspection: completed; still blocking for the source-shape reason above.
- Tests, scripts, typecheck, lint, build, Electron, Playwright/E2E, network, and packaged-app smoke:
  **not run**, as explicitly required. Ral owns real-window loading and timeout acceptance.

## Conclusion

**BLOCKED — one P2 blocking finding remains.**

The runtime loading implementation continues to satisfy the task contract with no new P0-P2
defect. The only blocker is the incomplete source-guard repair: its new anchor names the correct
method but still excludes the JSDoc that actually separates the two methods.
