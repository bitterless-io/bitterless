# Maestro startup shows BitterLess before the primary window

Status: implemented; owner verification pending

## Observed behavior

With a persisted authenticated session, application startup first exposes the BitterLess Home
window on its legacy `/chat` route. The title says `BitterLess` and the empty surface says `New
Chat`; only after asynchronous session activation and Maestro boot does the authenticated primary
Maestro window replace it.

The visible surface is not produced by the standalone `projects/maestro` process. Bitterless creates
its Home BrowserWindow with `show: false`, but the shared window helper automatically shows it on
`ready-to-show`. Persisted-session validation and `AuthHandler.activateSession()` happen later in
the Home renderer, so the Home window is guaranteed to flash before the existing
`open Maestro -> hide Home` transition completes.

## Required behavior

- With no persisted session, an invalid session, or a recoverable session/primary-window startup
  failure, Bitterless Home remains the visible login/recovery surface.
- With a valid persisted session, Bitterless Home never becomes visible automatically. It remains a
  hidden auth/bootstrap host until the complete Maestro primary window is ready.
- Maestro is shown only after its localized Home renderer has mounted and its existing operation,
  Control, and Workbench readiness chain has completed. A partially initialized window must not be
  revealed to avoid replacing one startup flash with another.
- Bounded Maestro/SQLite readiness failures tear down the partial runtime and return to the hidden
  Home window's existing login/recovery UI.
- Explicit Dock/tray activation continues to use the current session-aware primary-window command.

## MenuBar correction

Omni Browser is the visual and geometric reference. Its MenuBar is 32px high; Maestro's top tab
strip must be exactly 12px taller:

```text
┌─ Maestro top tab strip · 44px · #4e5882 ───────────────────────────────┐
│ ● ● ●  [pinned] [browser tab] [+]                     integrated drag │
├─ address and actions · unchanged 48px ─────────────────────────────────┤
│ back · forward · reload | address | capture · workbench · update       │
└─────────────────────────────────────────────────────────────────────────┘
```

- macOS traffic lights: `{ x: 12, y: 14 }`, preserving Omni's horizontal alignment and moving the
  32px reference down by half of the added 12px.
- macOS tab-strip content starts after the matching 78px Omni traffic-light gutter.
- Top strip: `#4e5882`, bottom border `#3d4666`, white active tabs, translucent-white idle tabs and
  controls, existing 13px compact system typography.
- The address row remains 48px and keeps its existing light treatment. Total Maestro chrome changes
  from 96px to 92px; renderer-measured native-view geometry remains authoritative.

## Acceptance

- Relaunch with a valid persisted session: the first application window shown is Maestro; no
  `BitterLess`/`New Chat` frame appears.
- Relaunch signed out and with failed session recovery: Home login/recovery is visible and usable.
- Force a Maestro readiness failure: partial Maestro state is destroyed and Home is shown.
- On macOS, the three native controls are vertically centered inside the 44px top strip; the strip
  matches Omni Browser's dark chrome and is exactly 12px taller.

Implementation task: [maestro-startup-chrome-005](../plan/tasks/maestro-startup-chrome-005.md).
Independent review: [maestro-startup-chrome-005-1](../plan/reviews/maestro-startup-chrome-005-1.md).
