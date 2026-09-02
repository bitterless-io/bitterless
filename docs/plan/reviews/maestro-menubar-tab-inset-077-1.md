# maestro-menubar-tab-inset-077 — Review 1

- Date: 2026-08-31
- Scope: independent review of the current-worktree implementation against
  `docs/plan/tasks/maestro-menubar-tab-inset-077.md`.
- Method: task/design/source/diff inspection, bounded `rg`, exact CSS geometry arithmetic, and
  task-owned whitespace checks only. Per the task contract, no tests, typecheck, lint, build,
  Electron, Playwright/E2E, network, or packaged-app smoke was run.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Exact `36/28/48/84px` geometry | Maestro Home imports `common/style.css`, whose global rule makes every element border-box (`src/renderer/maestro/home/src/main.ts:3-5`; `src/renderer/maestro/common/style.css:4-11`). The tab strip remains `36px` with 4px top padding, 3px bottom padding, and a 1px bottom divider (`MenuBar.less:10-22`), leaving the exact `36 - 4 - 3 - 1 = 28px` content band. Tabs and row wrappers remain 28px (`MenuBar.less:37-45,93-99`), the address row remains 48px (`MenuBar.less:104-114`), and the parent remains 84px (`MenuBar.less:1-8`), so `36 + 48 = 84`. | pass |
| Every tab-row participant is vertically centered | The strip now centers its immediate children and the tab list centers its 28px children (`MenuBar.less:10-35`). The divider, New-tab, and capture-status wrappers all retain 28px height and replace bottom-only `align-self: flex-end` with `align-self: center` (`MenuBar.less:93-99`). Thus the tab list, every tab, the nested divider, New-tab wrapper, and recording slot occupy the same 28px content band without bottom attachment. | pass |
| Complete border and four-corner shape | Every `.maestro-menu-bar__tab` remains 28px and retains `border: 1px solid transparent`; the old `border-bottom: 0` override is gone and the radius is now one `6px` value for all four corners (`MenuBar.less:37-51`). Pinned, active, and idle state rules continue to select their established border/background/text colors at `MenuBar.less:53-58`; a transparent state border still occupies the complete 1px border box rather than removing one edge. | pass |
| Width, state, loading, close, and drag behavior preserved | Pinned width remains 96px; browser tabs remain 200px with a 48px minimum and shrinking enabled (`MenuBar.less:59-60`). State/hover colors, dragging opacity, 16px favicon/loading slot, ellipsis label, absolute 20px close control, focus styles, New-tab behavior, capture status, and drag/no-drag CSS remain at `MenuBar.less:53-102`. `MenuBar.vue` has no task diff: activation/context-menu/reorder handlers remain at `MenuBar.vue:117-136`, loading still swaps inside the fixed favicon slot at `MenuBar.vue:137-152`, close behavior remains at `MenuBar.vue:156-171`, and New-tab/capture markup remains at `MenuBar.vue:182-209`. The task word diff changes only vertical alignment/padding, the former missing bottom border, and the radius. | pass |
| Native-view bounds ownership is unchanged | First-frame Main geometry remains `TOOLBAR_H = 84`, with operation, Workbench, and Control views laid out below it (`maestroWindow.controller.ts:152-155,1501-1508`). Mounted renderer placeholders remain authoritative through `getBoundingClientRect` and `setViewBounds` (`Layout.vue:12-29,43-50`; `maestroWindow.controller.ts:1511-1522`). None of these files has a task diff. | pass |
| macOS traffic lights move only by the requested optical pixel | `window.helper.ts:62-64` preserves `titleBarStyle: 'hiddenInset'`, preserves `x: 12`, and changes only `y: 10` to `y: 11` behind the existing Darwin condition. The comment truthfully calls this Ral's requested one-pixel downward optical adjustment rather than claiming that source arithmetic proves native visual centering. The renderer keeps the same 78px macOS gutter at `MenuBar.less:24-27`. | pass |
| Non-macOS native options remain unchanged | The focused `window.helper.ts` diff contains only the traffic-light comment and `10 → 11`; the platform condition and non-Darwin `undefined` branch are unchanged. Window show/background/menu, `1360 × 900` size, `800 × 600` floor, restored bounds, `windowOptions` merging, partition, preload, sandbox, context isolation, and node-integration options remain byte-for-byte outside that two-line hunk (`window.helper.ts:51-74`). | pass |
| Documentation/source consistency | `docs/features/maestro.md:247-265`, `docs/issues/maestro-menubar-tabs-not-inset.md:20-53`, and the task contract consistently specify the `4 + 28 + 3 + 1 = 36` inset, complete four-corner tab shape, unchanged 48/84px chrome, `x: 12, y: 11`, retained 78px gutter, and owner visual acceptance. Current source matches those boundaries. | pass |
| Static whitespace gate | Task-owned `git diff --check` passed for both source files and the tracked design/index paths. Direct trailing-whitespace inspection passed for the new issue and task documents; this review was checked after creation. | pass |

## Verification

- Border-box padding and `36/28/48/84px` arithmetic: passed.
- Tab list/wrapper vertical-centering audit: passed.
- Complete border/four-corner radius and state-preservation audit: passed.
- Width/loading/close/drag/no-drag behavior audit: passed.
- Native-view measurement/bounds ownership audit: passed.
- macOS optical-adjustment and non-macOS option diff audit: passed.
- Documentation/source and task-owned whitespace audit: passed.
- Tests, typecheck, lint, build, Electron, Playwright/E2E, network, and packaged-app smoke:
  **not run**, as explicitly required. Ral owns real-window visual acceptance of the native controls
  and inset tabs.

## Conclusion

**Approved — no blocking or non-blocking findings.**

The current implementation preserves the compact Maestro chrome and every tab interaction while
placing all 28px tab-row participants inside the exact border-box inset, restoring each tab's full
four-corner shape, and limiting the native-window change to the documented macOS one-pixel optical
adjustment.
