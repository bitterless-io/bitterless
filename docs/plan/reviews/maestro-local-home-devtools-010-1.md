# maestro-local-home-devtools-010 — Review 1

- Date: 2026-08-26
- Scope: independent review of the current-worktree fixed-Home DevTools implementation, its
  focused source/policy check, and the unchanged Maestro renderer and tab-lifecycle boundaries.
- Method: requirements/source/task-diff inspection, focused policy/source check, Node typecheck,
  and whitespace check. Build was not repeated. Electron, Playwright/E2E, the real application,
  and packaged smoke were not run.

## File list

| # | File | Findings |
|---|---|---:|
| 1 | `src/main/maestro/windows/main/maestroBrowserView.service.ts` | 0 |
| 2 | `scripts/maestro/check-devtools-debug.mjs` | 0 |
| 3 | `src/main/maestro/windows/main/maestroWindow.controller.ts` (audit only) | 0 |
| 4 | `src/main/maestro/windows/main/maestroControlView.service.ts` (audit only) | 0 |
| 5 | `src/main/maestro/windows/main/maestroWorkbenchView.service.ts` (audit only) | 0 |
| 6 | `docs/features/maestro.md` | 0 |
| 7 | `docs/plan/tasks/maestro-local-home-devtools-010.md` | 0 |

## Findings

No P1, P2, or P3 findings. There are no blocking or non-blocking task-scope defects to report.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Enable only compiled debug outside E2E | `maestroBrowserView.service.ts:46-49` exports one bounded policy that rejects every compiled mode except `debug` and returns false for `BITTERLESS_E2E=1`. It does not consult any runtime flag capable of promoting a compiled release build. | pass |
| Hostile runtime flags cannot enable release | `check-devtools-debug.mjs:95-114` executes all five DevTools policies with compiled `release`, development truthy, both runtime `VITE_ENV` values, and every supported hostile DevTools flag; all must remain false. Lines 116-166 separately prove fixed Home is automatic in debug and all policies remain suppressed in debug E2E. | pass |
| Every completed fixed-Home load reopens when needed | The shared `did-finish-load` listener resolves the current owner and invokes the same fixed-Home opener only for the pinned Home (`maestroBrowserView.service.ts:812-816`). The opener's live-view and `isDevToolsOpened()` guards make reloads idempotent. | pass |
| Both Home activation paths use the same opener | `activateTab()` calls `openPinnedHomeDevTools()` when the already-active Home is re-selected (`maestroBrowserView.service.ts:1085-1100`) and after Home is activated from another tab (`1124-1139`). Thus manually closing DevTools is repaired on either return path. | pass |
| Reject missing, non-Home, stale, cooling, and destroyed views | `openPinnedHomeDevTools()` rejects absent/non-pinned-Home inputs before dereference (`443-446`). `isLiveTabView()` additionally requires the tab to remain in the current collection, own the exact view, not be cooling, and have live web contents (`477-484`). | pass |
| Do not duplicate or steal focus; report failure | `maestroBrowserView.service.ts:447-452` exits when DevTools is already open, otherwise uses `openDevTools({ mode: 'detach', activate: false })`; synchronous Electron failures go through the existing Maestro `emitTrace` error surface. | pass |
| Keep ordinary operation, Control, and Workbench policies independent | The task diff adds only the fixed-Home policy/opener/call sites in the browser-view service. Existing operation logic at `308-318` remains opt-in through `COACH_DEVTOOLS`, and the Control/Workbench sources have no task diff. The focused check retains and executes their compiled-mode/E2E/flag assertions. | pass |
| Preserve renderer, preload, partition, navigation, capture, and tab lifecycle | The fixed view still uses `maestroLocalHome.js`, context isolation, disabled Node integration, and `MAESTRO_PARTITION` (`410-424`). The task does not alter renderer/preload/shared sources, navigation confinement, capture/replay ownership, warming/cooling, loading, visibility, bounds, or persistence; its activation additions only invoke the guarded opener. | pass |
| Focused assertions are meaningful | `check-devtools-debug.mjs:22-42` extracts and executes the real policy bodies. Lines `171-215` assert the opener's guards, deduplication, detached options, trace behavior, every-load hook, and both activation call sites. The script passes. | pass |
| Removed controller assertion was obsolete | The removed assertion required `MaestroWindowController.create()` to call `openOperationDevTools()`, but both current `HEAD` and the worktree controller create flow load the pinned Home without that call (`maestroWindow.controller.ts:330-375`). Ordinary operation policy is still audited directly in the browser-view service, so removing the stale controller claim narrows the check to behavior that exists without weakening this task's fixed-Home coverage. | pass |

## Verification

- `node scripts/maestro/check-devtools-debug.mjs`: **pass** (`[check-devtools-debug] ok`).
- `yarn typecheck:node`: **pass**.
- `git diff --check`: **pass**.
- `yarn build`: **not repeated by this independent review**, per the assigned verification scope;
  developer/root build evidence remains the delivery gate.
- Electron, Playwright/E2E, real-app verification, and packaged smoke: **not run**, as required.
  Ral owns final visual/runtime acceptance of DevTools opening and reopening.

## Conclusion

**PASS — no P1/P2/P3 findings.**

The fixed Home now owns one automatic detached DevTools window in compiled debug runtimes, repairs
it after every completed load or Home reactivation, and remains inert in release and E2E. The
guard rejects stale/non-Home/destroyed views, avoids duplicates and focus theft, and leaves the
ordinary operation, Control, Workbench, renderer/preload, capture, and tab-lifecycle contracts
unchanged.
