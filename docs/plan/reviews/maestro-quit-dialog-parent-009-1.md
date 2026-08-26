# maestro-quit-dialog-parent-009 — Review 1

- Date: 2026-08-26
- Scope: independent review of the current-worktree implementation for BaseWindow-aware dialog
  ownership and the unchanged quit/authentication lifecycle boundaries.
- Method: requirements/source/diff inspection, focused Node test, Node typecheck, and whitespace
  check. Electron, Playwright/E2E, the real application, packaged smoke, and build were not run.

## File list

| # | File | Findings |
|---|---|---:|
| 1 | `src/main/dialog/dialogParent.service.ts` | 0 |
| 2 | `src/main/dialog/dialog.helper.ts` | 0 |
| 3 | `tests/maestro/maestroQuitDialogParent.test.mjs` | 0 |
| 4 | `src/main/app.main.ts` (audit only) | 0 |
| 5 | `src/main/xpc/auth.handler.ts` (audit only) | 0 |
| 6 | `docs/issues/maestro-quit-reveals-hidden-home.md` | 0 |
| 7 | `docs/features/maestro.md` | 0 |
| 8 | `docs/plan/tasks/maestro-quit-dialog-parent-009.md` | 0 |

## Findings

No P1, P2, or P3 findings. There are no blocking or non-blocking task-scope defects to report.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Prefer the focused visible, non-destroyed `BaseWindow` | `dialogParent.service.ts:6-15` first validates the focused candidate with a short-circuit destroyed/visible guard and returns it before inspecting candidate order. | pass |
| Use only a visible, non-destroyed fallback | `dialogParent.service.ts:14-15` returns the first candidate passing the same guard; hidden-only, destroyed-only, and empty inputs resolve to `null`. The guard checks `isDestroyed()` before calling `isVisible()`. | pass |
| Resolve Electron ownership across all top-level windows | `dialog.helper.ts:1-6` imports `BaseWindow` and calls `BaseWindow.getFocusedWindow()` plus `BaseWindow.getAllWindows()`; neither `BrowserWindow` nor indexed first-window fallback remains. | pass |
| Use parented/unparented overloads correctly | `dialog.helper.ts:8-13` calls `dialog.showMessageBox(owner, options)` only with a resolved owner and otherwise calls `dialog.showMessageBox(options)`, so a hidden Home cannot be surfaced as a fallback parent. | pass |
| Apply one rule to quit and Keychain dialogs | `dialog.helper.ts:28,46` routes both public dialog paths through `showMessageBoxWithResolvedParent`. | pass |
| Preserve copy, button order, cancel/default IDs, and result semantics | The helper diff changes only owner resolution around the existing option objects. Keychain copy/IDs remain unchanged; quit keeps the existing Darwin/non-Darwin button order, IDs, and response mapping at `dialog.helper.ts:35-48`. | pass |
| Preserve quit/update lifecycle | `src/main/app.main.ts` has no task diff. Its `before-quit` handler still bypasses confirmation for helper/E2E/update flows, performs bounded cleanup before confirmed quit, and resets `hasShownQuitDialog` on cancellation (`app.main.ts:639-680`). | pass |
| Preserve hidden Home auth/bootstrap ownership | `src/main/xpc/auth.handler.ts`, `src/main/windows/mainWindow.helper.ts`, and `src/main/xpc/maestroWindow.handler.ts` have no task diff. Authenticated activation still opens Maestro then hides Home; deactivation still restores Home. | pass |
| Focused tests are meaningful | `maestroQuitDialogParent.test.mjs:29-82` executes the bundled pure selector for focused priority, visible fallback, hidden-only, destroyed, and empty cases, then checks the helper's BaseWindow integration, absence of BrowserWindow/indexed fallback, overload split, and both consumers. | pass |

## Verification

- `node --test tests/maestro/maestroQuitDialogParent.test.mjs`: **pass**, 6/6.
- `yarn typecheck:node`: **pass**.
- `git diff --check`: **pass**.
- `yarn build`: **not repeated by this independent review**; it is a delivery gate for the root
  orchestrator/developer, and the project build can rewrite tracked debug metadata unrelated to this
  review's sole writable file.
- Electron, Playwright/E2E, real-app visual verification, and packaged smoke: **not run**, as
  required. Ral owns final `Cmd+Q` runtime acceptance.

## Conclusion

**PASS — no P1/P2/P3 findings.**

Dialog ownership now follows the focused visible `BaseWindow`, falls back only to another visible
non-destroyed window, and becomes unparented when no safe owner exists. The former arbitrary hidden
Home fallback is removed from both quit and Keychain dialogs without changing the existing
quit/update cleanup flow or Home's authentication/bootstrap responsibilities.
