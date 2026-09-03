# Maestro window reopen performs a full cold boot

Status: implemented; owner packaged verification pending

## Observed behavior

Closing the Maestro main window and opening it again from Bitterless is visibly slow. The native
close handler destroys the entire Maestro runtime, so the next open waits for shutdown and then
recreates the hidden SQLite host, session, Shell, fixed Home, Control, Workbench, and agent runtime
before showing the window.

The retained-runtime fix removes that ordinary close/reopen cold boot, but it cannot explain an
intermittent slow startup, an auth-triggered rebuild, or a failed packaged renderer load. A recent
Preview sample includes `ERR_FAILED (-2)` while loading a packaged Maestro renderer followed by the
hidden SQLite window being destroyed; current logs do not identify which renderer/readiness stage
failed.

## Required behavior

- A normal native window close hides the existing Maestro `BrowserWindow` and preserves its runtime.
- Tray, Dock, second-instance, and Mini Apps Open restore and focus that same live window without a
  renderer or SQLite cold boot.
- Authentication invalidation/logout still destroys authenticated Maestro state and recreates the
  fixed Home on Login.
- Bitterless quit/update still awaits complete Maestro scheduler, capture, agent, view, proxy, and
  SQLite shutdown.
- Unexpected or explicit native destruction still finalizes the complete Maestro runtime.
- Every Open request records whether it reused the live window, joined an existing boot, or started
  a cold boot. Cold boot records privacy-safe stage timings through SQLite, Session, Shell, fixed
  Home, Control, Workbench, all-ready, and final show so the next packaged failure is attributable.

## Acceptance

- Source regression proves the `close` event prevents the native close and hides the live window
  without calling runtime destruction.
- Source regression proves `closed`, auth cleanup, and host quit retain their complete destruction
  paths.
- Reopening through the existing singleton branch calls `show()` without entering `boot()`.
- Electron/E2E is left to owner verification.

Implementation task:
[maestro-window-reopen-retain-runtime-104](../plan/tasks/maestro-window-reopen-retain-runtime-104.md).

Diagnostic task:
[maestro-open-diagnostics-113](../plan/tasks/maestro-open-diagnostics-113.md).

## Delivery

- Normal red-light/native close now hides the existing Maestro window and leaves its complete view,
  SQLite, tab, agent, and scheduler graph alive.
- Explicit destruction, authentication teardown, application quit, and update installation retain
  complete runtime cleanup.
- Focused lifecycle plus related Home/logout regressions passed 11/11; Node type checking and diff
  checks passed. The broader embedded-host check remains blocked by unrelated existing alias-boundary
  violations, as recorded in the implementation task.
- Main now emits correlated `[maestro-open]` request/boot route, stage, pending, show, and terminal
  records through the existing profile `main.log`, with fixed privacy-safe fields only.
- Focused diagnostics/lifecycle tests passed 8/8, Node typecheck and the Maestro CLI integration
  check passed, and [independent review 1](../plan/reviews/maestro-open-diagnostics-113-1.md) found no
  P0-P3 issue.

## Preview 0.0.86 regression evidence

- Two normal cold boots reached the primary Shell/Home host mount in 385--417ms but remained hidden
  until Workbench and pinned Home completed at about 4.3 seconds.
- A failed run waited 30 seconds for optional Home/startup/all-ready stages and destroyed the whole
  graph even though the primary Shell had mounted in about 390ms.
- Fixed Home currently preloads about 8.54MiB of JavaScript, including Settings-only Monaco/editor
  chunks, because the Home router and Settings panels are statically imported.

The corrective contract is tracked by
[desktop-first-visible-performance-117](../plan/tasks/desktop-first-visible-performance-117.md):
now shows the mounted primary graph first, keeps optional startup progressive/non-destructive, and
lazy-loads Settings-only heavy bundles. The retained-runtime close/reopen behavior remains
unchanged; [independent review 1](../plan/reviews/desktop-first-visible-performance-117-1.md) passed.
