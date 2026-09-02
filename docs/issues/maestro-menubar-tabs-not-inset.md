# Maestro MenuBar tabs are bottom-attached and the macOS controls read high

Status: implemented; owner verification pending

## Observed behavior

The 36px Royal Blue tab strip aligns its 28px tabs and tab-row accessories against the bottom
divider. Each tab also removes its bottom border and rounds only its upper corners, so the tabs read
as attached browser-page tabs rather than centered controls. The macOS traffic lights use `y: 10`
and read one pixel high relative to the requested centered tab row.

```text
current 36px strip
┌──────────────────────────────────────────────────────────────┐
│ macOS ● ● ●                                                  │
│       ┌──── Home ────┐ ┌──── browser tab ────┐  +           │
└───────┴──────────────┴─┴─────────────────────┴───────────────┘ divider
```

## Required behavior

```text
centered 36px strip
┌──────────────────────────────────────────────────────────────┐
│ 4px inset                                                    │
│ macOS ● ● ●   ╭──── Home ────╮ ╭──── browser tab ────╮  +  │ 28px
│                 ╰──────────────╯ ╰─────────────────────╯     │
│ 3px inset + 1px divider                                     │
└──────────────────────────────────────────────────────────────┘
```

- Keep the tab strip at `36px`, each tab and tab-row wrapper at `28px`, the address row at `48px`,
  and total Maestro chrome at `84px`.
- Give the strip `4px` top padding and `3px` bottom padding. Together with its existing `1px`
  bottom divider, this creates a visually balanced 4px inset above and below the 28px tab row.
- Vertically center the tab list, divider wrapper, New-tab wrapper, and recording-status slot.
- Give every pinned, active, and idle `.maestro-menu-bar__tab` a complete `1px` border and `6px`
  radius on all four corners. Preserve each existing state color, hover treatment, width, loading
  icon, label, and close control.
- Keep macOS traffic lights at `x: 12` and move them down exactly one pixel from `y: 10` to `y: 11`
  as the requested optical correction. Native traffic-light rendering is Electron/macOS-owned, so
  real-window acceptance decides whether that one-pixel adjustment reads centered.
- Keep the macOS `78px` left gutter, drag/no-drag regions, tab compression, new-tab action,
  recording status, address row, native-view bounds, and non-macOS native window options.

## Acceptance

- Every visible Home/browser tab floats inside the Royal Blue strip with four rounded corners and
  the same vertical center.
- The New-tab control, divider, and recording slot remain centered with the tabs.
- Source geometry remains `36/28/48/84px`; the traffic-light position is `{ x: 12, y: 11 }`.
- Ral verifies the real macOS Electron window and whether the requested one-pixel optical shift is
  visually centered.

Implementation task:
[maestro-menubar-tab-inset-077](../plan/tasks/maestro-menubar-tab-inset-077.md).

Independent review:
[Review 1](../plan/reviews/maestro-menubar-tab-inset-077-1.md) approved with no P1/P2/P3
findings.
