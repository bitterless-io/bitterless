# maestro-local-home-branding-008 — Review 1

- Date: 2026-08-26
- Scope: independent review of the current-worktree implementation and documentation owned by
  `maestro-local-home-branding-008`; the dependent navigation task and existing Main/view lifecycle
  were inspected only where needed to establish unchanged boundaries.
- Method: source/diff inspection, focused Node test, asset hash/pixel audit, Node typecheck,
  Maestro aggregate check, and whitespace check. Electron, Playwright/E2E, the real application,
  and packaged smoke were not run.

## File list

| # | File | Findings |
|---|---|---:|
| 1 | `src/renderer/maestro/localHome/src/components/LocalHomeMenu.vue` | 0 |
| 2 | `src/renderer/maestro/localHome/src/localHome.less` | 0 |
| 3 | `src/renderer/maestro/localHome/src/localHome.router.ts` | 0 |
| 4 | `src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue` | 0 |
| 5 | `src/renderer/maestro/home/src/views/layout/Layout.vue` | 0 |
| 6 | `src/renderer/maestro/home/src/views/layout/Layout.less` | 0 |
| 7 | `src/renderer/maestro/common/assets/icons/bitterless-icon.png` | 0 |
| 8 | `src/renderer/maestro/workbench/src/views/WorkbenchAboutView.vue` | 0 |
| 9 | `tests/maestro/maestroLocalHomeBranding.test.mjs` | 0 |
| 10 | `docs/features/maestro.md` | 0 |
| 11 | `docs/issues/maestro-local-home-still-shows-chat.md` | 0 |
| 12 | `docs/plan/tasks/maestro-local-home-branding-008.md` | 0 |

## Findings

No P1, P2, or P3 findings. There are no blocking or non-blocking task-scope defects to report.

The task-authored TypeScript/JavaScript stays below the 800-line ceiling (`TS-1`), adds no
convertible `function` declaration (`TS-2`), keeps navigation behavior out of the branding change
(`FE-1`), and introduces no parameterized business-component emit (`FE-2`). Existing function
declarations outside the changed lines are not attributed to this task.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Hide only fixed-local-Home Settings | `LocalHomeMenu.vue:19-49` renders only Mini Apps and Connector, with the same click/Enter/Space behavior; no Settings/footer node remains. `localHome.router.ts:5-20` still registers the dedicated `setting` route with its local-only prop. | pass |
| Preserve the 56px rail and intended actions | The task removes footer-only styling without changing `LocalHomeApp.vue` rail width or the surviving Mini Apps/Connector controls. `localHome.less` retains the rail/body/content constraints and 12px item rhythm. | pass |
| Use one Bitterless asset at both sites | `MenuBar.vue:32,62-65` maps only `tab.kind === 'home'` to `bitterless-icon.png`; `Layout.vue:7,65-71` uses the same import for the centered splash; `Layout.less:22-35` keeps the splash centered at 56px. | pass |
| Asset is canonical and appropriately sized | The runtime file and `doc/app_icons/icon64.png` have identical SHA-256 `57e14c6...47d60`. A read-only Sharp audit regenerated the 64px pixels from `build/icon.png` using `scripts/generate_app_icons.mjs:21-26` and found exact decoded-pixel equality. The asset is 64x64 RGBA; existing CSS consumes it at 16px for the favicon and 56px for the splash. | pass |
| Keep generic/page favicons unchanged | `MenuBar.vue:62-65` changes only the Home branch; the page-favicon branch and empty-string generic fallback remain intact. The template still renders `IconCommon` on that fallback. | pass |
| Keep Maestro branding outside the two requested sites | `WorkbenchAboutView.vue:1-20` still imports and renders `app-logo.png`; repository search finds `bitterless-icon.png` only in the Home MenuBar and Layout sites. | pass |
| No Main/XPC/geometry/lifecycle expansion | The task has no diff under `src/main/maestro`, `src/preload/maestro`, or `src/shared/maestro`; the two SFC diffs are import/reference substitutions only. Tab sizing, pin/close logic, splash geometry, native-view bounds, and XPC calls are unchanged. | pass |
| Focused test is meaningful | `maestroLocalHomeBranding.test.mjs:30-82` checks the absent Settings entry/CSS, retained setting route, both asset consumers, unchanged web favicon/fallback, retained Workbench About logo, and exact runtime/generated asset bytes. It passes 6/6. | pass |

## Verification

- `node --test tests/maestro/maestroLocalHomeBranding.test.mjs`: **pass**, 6/6.
- `yarn typecheck:node`: **pass**.
- `git diff --check`: **pass**.
- `yarn check:maestro`: **baseline-blocked before its 38 parity scripts run** by the repository's
  existing Maestro host-alias audit. The reported list includes committed `HEAD` sources such as
  `main/llm/llmModels.ts:2`, `main/net/proxy.ts:1`, `renderer/control/src/ControlApp.vue:6`, and
  `renderer/workbench/src/views/WorkbenchAppsView.vue:4`, plus dependent task 007's already-reviewed
  local-Home imports. The branding diff adds no host alias: its two changed imports both remain
  inside the accepted `@maestro-renderer` boundary. This is not a branding-task regression.
- Electron, Playwright/E2E, real-app visual verification, and packaged smoke: **not run**, as
  required by the task and parent review instruction.

## Conclusion

**PASS — no P1/P2/P3 findings.**

The Settings action is hidden only from the fixed local Home rail, the internal Settings route is
preserved, and Home/New-tab branding now shares one canonical 64px Bitterless asset without
affecting generic browser favicons, Workbench/About branding, Main/XPC ownership, geometry, or
lifecycle. Ral's real-window visual acceptance remains the intended final handoff.
