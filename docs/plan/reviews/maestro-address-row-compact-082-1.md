# maestro-address-row-compact-082 — Review 1

- Date: 2026-08-31
- Scope: independent review of the current-worktree implementation against
  `docs/plan/tasks/maestro-address-row-compact-082.md` and
  `docs/issues/maestro-address-row-too-tall.md`.
- Method: task/issue/source/diff inspection, focused source-contract tests, targeted ESLint, and
  task-scoped `git diff --check`. Electron, Playwright/E2E, packaged smoke, build, and application
  launch were not run.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None. A stale Task 078 follow-on link observed during review was corrected
  from the nonexistent Task 079 path to `maestro-address-row-compact-082.md` before this verdict.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Exact `36 + 42 = 78px` top-chrome hierarchy | `MenuBar.less:1-20,97-107` sets the parent to 78px, preserves the tab strip at 36px, and reduces only the address row to 42px. Maestro Home imports `common/style.css`, whose universal rule applies `box-sizing: border-box` (`main.ts:3-5`; `common/style.css:4-11`), so the declared heights include their padding and divider. `MenuBar.vue:103-106,212-215`, `menuBar.store.ts:14-18`, the feature contract, task, and issue consistently describe the new geometry. | pass |
| Navigation and address are exactly equal at 28px | `.maestro-menu-bar__navigation` and `.maestro-menu-bar__address` both declare `height: 28px` (`MenuBar.less:109,144-155`). Border-box sizing means the navigation group's existing 2px padding is included in its 28px outer box rather than expanding it to 32px. Both remain centered by the 42px row's `align-items: center`. | pass |
| Only navigation-contained controls shrink to 24px | The shared `.maestro-menu-bar__nav-button, .maestro-menu-bar__snapshot` rule remains 32px square (`MenuBar.less:111-126`). The more-specific descendant rule changes only `.maestro-menu-bar__nav-button` instances inside `.maestro-menu-bar__navigation` to 24px (`MenuBar.less:128-131`), producing `24 + 2 + 2 = 28px`. The panel and Workbench nav-style actions live in the separate trailing action cluster (`MenuBar.vue:270-307`) and therefore remain 32px. | pass |
| Snapshot and other trailing actions remain unchanged | The Snapshot stays under `.maestro-menu-bar__actions` and retains the unchanged shared 32px action geometry and snapshot-specific colors (`MenuBar.vue:259-283`; `MenuBar.less:111-126,161-166`). The action divider remains 20px and the update pill remains 28px (`MenuBar.less:161-180`). No snapshot, panel, Workbench, update, URL, history, focus, or submit handler was changed by Task 082. | pass |
| Main's first frame starts all native views below 78px | `maestroWindow.controller.ts:152-155` changes the fallback constant and comment to 78px. `layout()` continues to derive `viewH` as `h - TOOLBAR_H` and applies `y: TOOLBAR_H` to browser, Workbench, and Control views (`maestroWindow.controller.ts:1501-1508`). Renderer-measured placeholder bounds remain authoritative afterward (`maestroWindow.controller.ts:1511-1522`). | pass |
| Unrelated injected 48px button is untouched | The remaining `height: 48px` / `line-height: 48px` at `maestroBrowserView.service.ts:1552-1565` belongs to the isolated injected `.mmc-btn`, not the MenuBar. That file has no Task 082 diff, so the implementation does not conflate this unrelated control with the address-row reduction. | pass |
| Task 077 inset/shape/native-control contract is preserved | The 36px strip still uses 4px top padding, 3px bottom padding, and its 1px divider around the unchanged 28px tab band (`MenuBar.less:10-20,37-45`). Tabs retain their complete border and four-corner 6px radius; tab list/divider/New-tab/capture wrappers remain centered (`MenuBar.less:29-45,89-95`). The macOS gutter stays 78px and the reviewed native traffic-light position stays `{ x: 12, y: 11 }` (`MenuBar.less:24-27`; `window.helper.ts:62-64`). Only the directly related window-height comment changed from 84px to 78px. | pass |
| Task 078 shared IconBtn contract is preserved | The close and New-tab actions remain shared `IconBtn` instances using Tabler `IconX`/`IconPlus`, with their existing event wiring (`MenuBar.vue:158-193`). Their scoped 20px/28px geometry, hover/active visibility, Royal Blue contrast, and centered wrappers are unchanged (`MenuBar.less:69-94`). The focused Task 078 contract tests pass alongside Task 082's tests. | pass |
| Focused regression contract covers the requested boundary | `tests/maestro/maestroAddressRowGeometry.test.mjs:22-51` asserts 78/36/42, equal 28px navigation/address boxes, 2px navigation padding, the descendant-only 24px override, unchanged 32px shared/trailing actions, and the Main 78px fallback plus its y/height uses. | pass |

## Verification

- `node --test tests/maestro/maestroAddressRowGeometry.test.mjs tests/maestro/maestroTabIconButtons.test.mjs`:
  **passed, 6/6**.
- Targeted ESLint (`--quiet`) on `MenuBar.vue`, `menuBar.store.ts`,
  `maestroWindow.controller.ts`, `window.helper.ts`, and the new focused test: **passed, exit 0**.
- Task-scoped `git diff --check`: **passed** before this review was created and rechecked after it.
- The initially stale Task 078 follow-on link was corrected to Task 082 and re-inspected before the
  final verdict.
- Electron, Playwright/E2E, packaged smoke, production build, and application launch: **not run**.
  Ral owns final visual acceptance in the real Maestro window.

## Conclusion

**Approved — no P1/P2/P3 findings remain.**

The implementation makes the address row exactly 6px shorter, aligns navigation and address at
28px without shrinking trailing actions, moves Main's first-frame native-view fallback to 78px,
and preserves the reviewed Task 077/078 tab geometry and IconBtn behavior. The focused static tests
and lint checks pass; only Ral's real-window optical check remains.
