---
status: completed
verify:
  - yarn build
  - login drag region moves the main window
  - moving or resizing persists x, y, width, and height after interaction stops
  - restarting restores the persisted main-window bounds
---

# Main Window Drag And Layout

## Goal

Make the frameless login window draggable and reliably restore the main window's last position and
size.

## Layout

```text
+--------------------------------------------------+
| draggable login title region                     |
+--------------------------------------------------+
|                                                  |
|               Bitterless login                   |
|                                                  |
+--------------------------------------------------+
```

## Contract

- The login page exposes a top drag region without visible controls or text.
- Login inputs, buttons, tabs, and the required first-password modal remain interactive.
- The main window keeps its `800x600` minimum size.
- Move and resize events share one trailing debounce, so SQLite is updated after interaction stops.
- Persisted layout contains `x`, `y`, `width`, and `height`.
- Persisted bounds override initial defaults when the main window is created on the next launch.

## Verification

- `yarn build` passes.
- Electron reports the login drag region as `-webkit-app-region: drag` at `0,0`, sized to the full
  window width and `40px` high.
- Moving and resizing the main window to `x=148`, `y=126`, `940x680` saves those exact bounds after
  the debounce interval.
- Restarting Electron restores `x=148`, `y=126`, `940x680` exactly.
