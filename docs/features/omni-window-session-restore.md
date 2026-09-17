# Omni Browser window session restore

Status: Implemented and independently code-verified; native multi-display behavior not exercised

## Requested behavior

Omni Browser remembers whether its window is open. When Bitterless starts again, it automatically
reopens Omni only if it was open in the preceding session, on the previous physical display at the
saved position and size.

## Contract

- Opening/showing Omni persists an open state. Minimizing it or hiding the application still counts
  as open. An explicit window close persists closed, so the next launch leaves Omni closed.
- Normal App quit and update/restart teardown preserve the last open state and flush current
  geometry. A canceled quit must not affect subsequent ordinary close behavior.
- A fresh install or a legacy geometry entry without an explicit open state does not automatically
  open Omni. Missing or invalid session state is treated as closed.
- Automatic restore runs once after Core SQLite is ready, using the existing Omni open coordinator
  and saved cell layout. It must not delay Home creation or create duplicate windows when a user
  also opens Omni. Shutdown fences prevent a pending startup restore from reopening a window.
- An automatic-open failure is logged and preserves the previous open intent for the next launch;
  internal cleanup is not an explicit user close. Manual opening remains available.
- Geometry uses the existing [window-state contract](window-state-persistence.md): normal bounds,
  maximized/fullscreen mode, physical display and work-area-relative coordinates. Restore applies
  geometry before first show. A disconnected display or changed work area clamps onto a connected
  display. macOS virtual desktops are outside the supported contract.
- This change applies to Omni only. Embedded cell content keeps its existing persistence contract.

## Storage and lifecycle ownership

Main stores explicit open intent in `userData/omni-window-session.json` with an atomic temporary-file
write and rename. Existing geometry remains in `userData/window-state.json` under `omni`; no SQLite
schema change or legacy geometry migration is needed for the new flag.

The Omni helper records explicit window transitions and owns a reversible shutdown fence. App
startup schedules one restore after Core SQLite readiness; App cleanup sets the fence before
asynchronous teardown and clears it if cleanup fails. Internal window destruction preserves intent.

## Verification

Node tests exercise persisted state across fresh service instances, open/manual-close/App-quit
transitions, startup gating and failure behavior. Geometry tests cover connected secondary
displays, moved display origins, disconnected displays and changed work areas. Run applicable
type checks and build without launching Electron or desktop E2E.

Completed validation: 74/74 Omni and startup tests, including 18 session lifecycle cases; full
Main/preload/renderer build and strict session-service typecheck passed. Main/shared typecheck
reports 65 existing diagnostics, identical to the pre-change source comparison, with no new
diagnostics. No real Electron window or E2E was launched.

See [delivery task](../plan/tasks/omni-window-session-restore-001.md) and
[independent review](../plan/reviews/omni-window-session-restore-001-1.md).
