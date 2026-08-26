# Hot reload reveals the legacy authenticated Home window

Status: implemented; owner verification pending

## Observed behavior

During development hot reload or a Main-process restart, Bitterless can show the hidden legacy Home
`BrowserWindow` on its authenticated `/chat` route. The visible frame says `BitterLess` and the
content says `New Chat`, even though Maestro is the authenticated primary window and the old Home
renderer exists only as an invisible auth/bootstrap host.

The legacy Home `BrowserWindow` is still treated as a possible visible primary in the old auth
lifecycle. Main restart, Dock activation, tray Open, second-instance activation, Login mount, or
logout can therefore call `mainWindowHelper.show()` even though the product's actual primary shell
is now Maestro and Home content lives in Maestro's fixed local-Home miniapp.

## Required behavior

- Maestro is the only visible primary window, independent of legacy Home authentication state.
- Cold start, Dock activation, tray Open, second-instance activation, auth activation, logout, and
  invalidation all open or focus the existing Maestro singleton.
- The legacy Home `BrowserWindow` remains alive only as a hidden renderer/XPC authority for its
  existing token, Todo, and compatibility responsibilities. It is never shown or focused.
- Home content remains the fixed local-Home miniapp inside Maestro; this issue does not create a
  second native window or another visibility state machine.

## Acceptance

- Trigger renderer and Main hot reload while signed in: no `BitterLess` / `New Chat` legacy window
  appears before or beside Maestro.
- Trigger cold start, Dock activation, tray Open, a second instance, logout, and invalidation: each
  leaves Maestro as the visible/focusable primary and legacy Home hidden.
- Source tests prove there is no `mainWindowHelper.show()` path and that Home is configured as a
  hidden, taskbar-free runtime.

Implementation task:
[maestro-hot-reload-home-visibility-012](../plan/tasks/maestro-hot-reload-home-visibility-012.md).

## Delivery

- Cold startup, Tray, Dock activation, and second-instance activation now open the Maestro
  singleton directly.
- Auth activation, compatibility `showHomeWindow()`, generic primary activation, logout, and
  invalidation all converge on Maestro and defensively hide legacy Home.
- The legacy Home helper is taskbar-free, self-hides any show event, and overrides `show()` as a
  hidden-runtime guard while retaining detached debug DevTools.
- Focused source regression: 4/4; customer-auth regression: 20/20; Node typecheck and debug build:
  passed. Electron/E2E was intentionally left to owner verification.
