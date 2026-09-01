# Maestro window reopen performs a full cold boot

Status: implemented; owner verification pending

## Observed behavior

Closing the Maestro main window and opening it again from Bitterless is visibly slow. The native
close handler destroys the entire Maestro runtime, so the next open waits for shutdown and then
recreates the hidden SQLite host, session, Shell, fixed Home, Control, Workbench, and agent runtime
before showing the window.

## Required behavior

- A normal native window close hides the existing Maestro `BrowserWindow` and preserves its runtime.
- Tray, Dock, second-instance, and Mini Apps Open restore and focus that same live window without a
  renderer or SQLite cold boot.
- Authentication invalidation/logout still destroys authenticated Maestro state and recreates the
  fixed Home on Login.
- Bitterless quit/update still awaits complete Maestro scheduler, capture, agent, view, proxy, and
  SQLite shutdown.
- Unexpected or explicit native destruction still finalizes the complete Maestro runtime.

## Acceptance

- Source regression proves the `close` event prevents the native close and hides the live window
  without calling runtime destruction.
- Source regression proves `closed`, auth cleanup, and host quit retain their complete destruction
  paths.
- Reopening through the existing singleton branch calls `show()` without entering `boot()`.
- Electron/E2E is left to owner verification.

Implementation task:
[maestro-window-reopen-retain-runtime-104](../plan/tasks/maestro-window-reopen-retain-runtime-104.md).

## Delivery

- Normal red-light/native close now hides the existing Maestro window and leaves its complete view,
  SQLite, tab, agent, and scheduler graph alive.
- Explicit destruction, authentication teardown, application quit, and update installation retain
  complete runtime cleanup.
- Focused lifecycle plus related Home/logout regressions passed 11/11; Node type checking and diff
  checks passed. The broader embedded-host check remains blocked by unrelated existing alias-boundary
  violations, as recorded in the implementation task.
