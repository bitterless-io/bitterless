# Top-level Window State Persistence

Status: Active delivery contract

## Purpose

Every user-visible top-level window created by Bitterless Main remembers its normal position and
size, window mode, and physical display. Reopening the same logical window restores it to the same
display and work-area-relative position whenever that display is still connected.

This contract replaces the independent Home, Todo, Omni, EyesOnAgents, Coin, and Maestro geometry
implementations. It covers window chrome only; renderer business state and embedded
`WebContentsView` layout remain owned by their existing modules.

## Window identities

The Main-owned state file uses one stable key for every reachable user-visible top-level window:

| Key | Window |
|---|---|
| `main` | Home, including login and authenticated routes |
| `todo` | standalone Todo |
| `omni` | Omni `BaseWindow` |
| `eyes-on-agents` | standalone EyesOnAgents |
| `maestro` | Maestro / legacy Cowork main window |
| `coin` | Coin |
| `plugin-content` | development Plugin Content window |
| `plugin-options` | development Plugin Options window |

The Core SQLite host, Maestro SQLite host, PDF rendering window, detached DevTools, and embedded
Todo/Omni/Maestro views are hidden, ephemeral, or child surfaces and never receive a state key.
The dormant Connector and Llama helpers have no creation entry and remain outside the registry.
Any future reachable top-level window must register a stable key; an internal window must opt out
explicitly.

## Persisted state

`userData/window-state.json` is a Main-owned atomic JSON map keyed by the identities above. Each
entry contains:

```ts
interface PersistedWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
  fullScreen?: boolean;
  displayId?: number;
  displayWorkArea?: { x: number; y: number; width: number; height: number };
  relativeX?: number;
  relativeY?: number;
}
```

- Bounds always come from `getNormalBounds()`, never the maximized or fullscreen frame.
- `displayId` comes from `screen.getDisplayMatching(normalBounds)` and is persisted only when it is
  non-negative. Electron's negative invalid/unified-desktop ids cannot identify one physical
  display reliably.
- Relative coordinates are measured from the matched display's current `workArea` origin.
- Electron bounds and display work areas are already device-independent pixels. No
  `scaleFactor` multiplication or division is allowed.
- Malformed, non-finite, unreasonably large, or smaller-than-window-minimum state is ignored.
- Writes use a temporary file followed by rename so a crash cannot leave a partially written map.
- Different windows share one in-process store and update only their own key.

## Capture lifecycle

Each registered window has exactly one persistence controller:

1. `move` and `resize` schedule one trailing save after the interaction settles.
2. `maximize`, `unmaximize`, `enter-full-screen`, and `leave-full-screen` also schedule state
   capture.
3. `close` and every host-owned explicit destroy path flush the latest state before the window is
   destroyed.
4. `closed` cancels pending timers and unregisters the window; it never tries to read geometry.
5. An unchanged captured entry is not rewritten.

The display service owns one process-wide listener set for display removal and display metric
changes. It keeps registered normal windows visible without creating one listener per window.
Maximized and fullscreen windows are left to the operating system until they return to normal.

## Restore algorithm

The saved normal size is first constrained to the target window's minimum size, a sane maximum,
and the target display's current work area. Position is then resolved in this order:

1. If the saved non-negative `displayId` is connected, restore on that display at the saved
   work-area-relative position.
2. If the id changed but the saved display work-area fingerprint matches a connected display,
   restore relative to that display.
3. If the saved absolute rectangle still has a usable overlap with a connected display, keep its
   absolute position.
4. Otherwise map the saved relative position to the primary display.

Every path clamps the final rectangle to the selected current `workArea`. A display disconnect,
resolution change, taskbar/Dock work-area change, or DPI change therefore cannot strand a window
off-screen. If a work area is smaller than Bitterless's `800x600` minimum, the minimum is preserved
and the window is anchored at the work-area origin.

On macOS, each `BrowserWindow` reasserts restored bounds immediately before its first `show()`;
construction-time secondary-display or negative-coordinate placement alone is not authoritative.
Omni has no `ready-to-show`, so it reasserts state after its menubar finishes loading and before
showing the `BaseWindow`. Maximized or fullscreen mode is applied only after normal bounds.

Electron does not expose a supported way to identify or move a window to a macOS Mission Control
Space. This contract remembers the physical display, not the virtual desktop.

## Legacy import

Import is lazy and one-time per missing unified key:

- `window_layout/main`, `window_layout/todo`, `window_layout/omni`, and
  `window_layout/eyes-on-agents` from `SettingDao`;
- `userData/coin/window-state.json` for Coin;
- `userData/cowork/window-state.json` key `cowork-main` for Maestro.

Legacy state is validated and normalized through the same restore path before the unified entry is
written. Once a unified key exists, its older source is no longer read or dual-written. Home may
hydrate an SQLite-only legacy entry after startup, but neither SQLite readiness nor migration may
delay Home creation.

## Acceptance

- Moving and resizing each reachable top-level window, closing it, and reopening it restores the
  final normal bounds.
- Maximized and fullscreen windows reopen in the same mode while retaining their prior normal
  bounds for the next unmaximize/exit-fullscreen action.
- A window last used on a connected secondary display reopens on that physical display.
- Disconnecting that display or changing its work area restores the window fully usable on a
  connected display.
- Home startup remains independent of Core SQLite readiness.
- Existing Home, Todo, Omni, EyesOnAgents, Coin, and Maestro users retain their last usable legacy
  geometry after upgrade.
- Hidden and ephemeral windows never create entries.
