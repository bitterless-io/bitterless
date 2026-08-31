---
id: maestro-menubar-tab-inset-077
scope: Maestro tab-strip inset, four-corner tab shape, and macOS traffic-light alignment
status: implemented; owner verification pending
depends-on: [maestro-cowork-menubar-parity-006, maestro-tab-loading-indicator-011]
verify: source audit and independent review only; Ral owns Electron visual acceptance
---

# Center rounded Maestro tabs inside the compact MenuBar

## Objective

Inset every Maestro tab vertically inside the existing compact Royal Blue strip, round all four
tab corners, and move the macOS traffic lights down one pixel for the requested optical alignment.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-menubar-tabs-not-inset.md`
- `docs/issues/maestro-cowork-menubar-controls-outdated.md`
- `docs/plan/tasks/maestro-cowork-menubar-parity-006.md`
- `docs/plan/tasks/maestro-tab-loading-indicator-011.md`

## Path

- `src/renderer/maestro/home/src/components/MenuBar/MenuBar.less`
- `src/main/maestro/windows/window.helper.ts`
- `docs/{INDEX.md,features/maestro.md,issues,plan}/**`

## Contract

- Preserve exact `36px` tab-strip, `28px` tab/wrapper, `48px` address-row, and `84px` total chrome
  geometry. Do not change operation/Control view measurement or bounds ownership.
- In the border-box tab strip, use `padding-top: 4px` and `padding-bottom: 3px`; its existing `1px`
  bottom divider completes a visually symmetric four-pixel inset while retaining a 28px content
  band.
- Vertically center the strip's immediate content, the tab list and every 28px tab-row wrapper.
  Remove bottom-only alignment from the divider, New-tab, and capture-status wrappers.
- Keep each `.maestro-menu-bar__tab` at `28px`, restore its complete `1px` border, and use one `6px`
  radius on all four corners. Preserve pinned/active/idle colors, hover states, widths, compression,
  drag behavior, favicon/loading slot, label ellipsis, and close control.
- Keep the macOS native control position at `x: 12` and change only `y: 10` to `y: 11` as an optical
  adjustment verified by Ral in the real window. Preserve `hiddenInset`, the `78px` renderer gutter,
  window size/state, and every non-macOS window option.
- Do not change tabs, navigation, capture, Workbench, Control, update, i18n, loading watchdog, or
  fixed-Home behavior.
- Preserve every unrelated current-worktree change, especially the parallel Maestro,
  EyesOnAgents, and Mini Apps deliveries and their shared documentation indexes.

## Verification

- Independent source review verifies the exact padding arithmetic, centered tab-row ownership,
  four-corner tab border/radius, unchanged 36/28/48/84px geometry, `x: 12, y: 11` native controls,
  and untouched tab behavior.
- Task-owned `git diff --check` and new-file trailing-whitespace inspection must pass.
- Do not run tests, type checks, lint, builds, Electron, Playwright/E2E, network, or packaged-app
  smoke in this delivery. Ral owns the real-window visual acceptance.

## Delivery

- Implemented on 2026-08-31.
- The 36px tab strip now uses a border-box `4px` top / `3px` bottom inset around its unchanged 28px
  row and 1px divider. Tabs, the tab list, divider, New-tab wrapper, and recording slot share one
  centered content band.
- Every tab retains its complete 1px border and now uses a 6px radius on all four corners; existing
  widths, colors, loading, close, compression, drag, navigation, capture, and fixed-Home behavior
  remain unchanged.
- macOS traffic lights retain `x: 12` and move from `y: 10` to `y: 11` for Ral's requested optical
  adjustment. `hiddenInset`, the 78px gutter, non-macOS options, and native-view bounds are unchanged.
- Independent source review: [Review 1](../reviews/maestro-menubar-tab-inset-077-1.md) — Approved,
  with no P1/P2/P3 findings.
- Task-owned static and whitespace checks passed. Tests, typecheck, lint, build, Electron,
  Playwright/E2E, network, and packaged smoke were intentionally not run; Ral owns real-window
  visual acceptance.
