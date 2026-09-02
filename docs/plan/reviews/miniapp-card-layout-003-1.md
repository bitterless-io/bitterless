# miniapp-card-layout-003 — Review 1

- Date: 2026-08-31
- Scope: independent review of the current-worktree implementation against
  `docs/plan/tasks/miniapp-card-layout-003.md`.
- Method: task, issue, shared renderer source, Arco Card implementation/default CSS, task-scoped
  diff, bounded `rg`, and whitespace inspection only. Per the task contract, no tests, typecheck,
  lint, build, Electron, Playwright/E2E, network, or packaged-app smoke was run.

## Findings

No P0-P2 findings. No non-blocking P3 finding identified.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Exact card geometry | `src/renderer/home/src/views/miniApp/MiniApp.less:14-22` keeps `width: 320px` and adds exact `height: 184px`; there is no `min-height: 184px`. The shared theme applies `box-sizing: border-box` to every element at `src/renderer/common/assets/style/theme.less:13-18`, so the border is included and the visible outer card remains exactly `320 × 184px`. The existing 12px wrapping grid gap, scroll owner, radius, border, background, and 24px icon remain at `MiniApp.less:1-12,19-21,36-46`. | pass |
| Card/body flex ownership and bottom action | `MiniApp.less:14-34` makes the Card a column flex container and its direct `> .arco-card-body` child the remaining-height column flex owner with `min-height: 0`. `MiniApp.less:31-34` keeps the actions non-shrinking and replaces Arco's normal action gap with `margin-top: auto`. Arco renders header and body as direct Card children, then renders the actions after default-slot content inside that body (`node_modules/@arco-design/web-vue/es/card/card.js:59-68,87-103`), so the flexible content consumes the available middle region and every Open action stays on the same bottom baseline without absolute positioning. | pass |
| Three-line clamp and hostile copy | `MiniApp.less:48-62` makes the description region flexible/shrinkable, clamps the subtitle with `display: -webkit-box`, vertical box orientation, `-webkit-line-clamp: 3`, and hidden overflow, and uses `overflow-wrap: anywhere` for long unbroken strings. This matches the task contract and prevents either a fourth visible line or horizontal card growth. | pass |
| `184px` fits the real Arco medium Card | The installed Arco Card defaults to medium, with a 46px border-box header and 16px vertical body padding (`node_modules/@arco-design/web-vue/es/card/style/index.css:164-180`); the Open button is a 24px mini button (`node_modules/@arco-design/web-vue/es/button/style/index.css:722-726`). With the shared border-box rule, a 184px outer card has 182px inside its 1px borders: `182 - 46 = 136px` for the body; `136 - 32 = 104px` inside body padding; `104 - 24 = 80px` for `.mini-app-page__card-content`; and its 16px vertical padding leaves 64px. Three `14px × 1.5 = 21px` subtitle lines need 63px, leaving 1px slack. The 46px header also leaves 25px after its 20px padding and 1px divider, enough for the unchanged 24px icon. No three-line copy or mini action needs to squeeze or overflow at the contracted height. | pass |
| Open/i18n/data behavior unchanged | The task diff changes only `MiniApp.less` under the shared Mini App source. `MiniApp.vue:21-31,52-106` still uses the existing Arco actions slot and Open button, per-app loading/disabled set, duplicate-open guard, translated label/error, failure message, and each catalog action. `miniApps.constant.ts:10-77` retains the same ids, localized names/subtitles, icons, and launch callbacks; neither file has a current-worktree diff. | pass |
| Maestro reuse and Workbench isolation | The renderer alias still maps `@` to `src/renderer/home/src` (`electron.vite.config.ts:528-538`), and Maestro local Home still imports that exact shared `MiniApp.vue` as its `/mini-app` route (`src/renderer/maestro/localHome/src/localHome.router.ts:1-14`). The shared component imports `./MiniApp.less` at `MiniApp.vue:109-111`, so local Home receives the fix without a duplicate style. Workbench continues to import only the shared catalog and its own `WorkbenchAppsView.less` (`WorkbenchAppsView.vue:1-14`), retaining its separate compact grid/item/Open markup at `WorkbenchAppsView.vue:49-77` and one-line subtitle CSS at `WorkbenchAppsView.less:1-51`; neither Workbench file has a task diff. | pass |
| Documentation/source consistency | `docs/features/README.md:29-35,50-70`, `docs/issues/miniapp-card-action-alignment.md:23-58`, and the task contract consistently define one shared fixed-Home `320 × 184px` card, a three-line description, a bottom-pinned Open action, unchanged launch behavior, and an untouched Workbench compact list. The current source implements those exact boundaries. | pass |
| Static whitespace gate | Task-scoped `git diff --check` passed for the tracked source/document paths. Direct trailing-whitespace searches passed for the new issue and task files; this review was checked after creation. | pass |

## Verification

- Exact size and no-min-height audit: passed.
- Arco DOM/flex ownership and bottom-baseline audit: passed.
- Three-line/overflow/long-word audit: passed.
- Arco medium-size fit calculation: passed.
- Open/i18n/catalog unchanged audit: passed.
- Maestro shared import and Workbench isolation audit: passed.
- Documentation/source and task-scoped whitespace audit: passed.
- Tests, typecheck, lint, build, Electron, Playwright/E2E, network, and packaged-app smoke:
  **not run**, as explicitly required. Ral owns real-window Chinese/English visual acceptance.

## Conclusion

**Approved — no P0-P2 findings.**

The current implementation gives every shared fixed-Home Mini Apps card an exact `320 × 184px`
border-box, reserves enough space for three complete description lines plus the existing mini Open
button, and pins that action through the real Arco body/actions layout. Maestro inherits the shared
component, while Open behavior, localized data, and the independent Workbench Apps presentation
remain unchanged.
