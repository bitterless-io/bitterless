# Maestro fixed Home exposes Mini Apps before authentication

Status: implemented; owner verification pending

## Observed behavior

Maestro is correctly the only visible primary window, but its fixed `bitterless://home` tab always
redirects to `/mini-app`. The original Bitterless Login implementation still exists in the hidden
Home renderer, while the fixed local Home has no authentication state and therefore exposes the
Mini Apps list to signed-out users.

The regression was introduced when the legacy Home `BrowserWindow` became a permanently hidden
authentication/bootstrap authority without adding an equivalent authentication gate to the visible
fixed Home tab.

## Required behavior

```text
┌─ Maestro primary window / fixed bitterless://home tab ────────────────┐
│ auth state unknown        │ neutral restoring/loading surface          │
│ signed out or invalid     │ existing Bitterless Login experience       │
│ saved session unavailable │ retry / cancel / switch-account recovery    │
│ invited account           │ required first-password setup               │
│ active session            │ 56px rail + Mini Apps / Connector workspace │
└────────────────────────────────────────────────────────────────────────┘
```

- Keep Maestro as the only visible native primary window. The legacy Home `BrowserWindow` remains
  hidden across startup, HMR, login, logout, invalidation, Dock, tray, and second-instance paths.
- Before showing Mini Apps, the fixed Home must obtain a strict authentication snapshot from the
  hidden Home authority. Unknown/restoring state must never fall through to authenticated content.
- Reuse the existing Login experience and behavior: password and OTP login, password reset,
  invited-account password setup, saved-session restore, retry, cancel, and switch account.
- The hidden Home renderer remains the sole owner of the customer token, device/session metadata,
  authentication HTTP calls, authenticated-runtime activation, and Todo readiness. Never copy the
  token into the Maestro partition or return it through XPC.
- Extend the bounded Home-shell bridge with typed authentication snapshots and commands. Snapshot
  broadcasts contain only non-sensitive presentation state; passwords and OTPs travel only in the
  addressed command call and are never logged or broadcast.
- A recreated fixed Home subscribes before its initial snapshot read, then renders the correct
  state. Login success switches the fixed Home to Mini Apps; logout or invalidation switches it back
  to Login without revealing the legacy native window.
- Preserve the pinned tab, `bitterless://home` display URL, local navigation confinement, XPC-only
  preload, i18n-before-mount fence, non-recordable/non-debuggable production behavior, Workbench
  Connector ownership, and existing Mini Apps card layout.

## Acceptance

- A signed-out cold start shows Maestro with the original Bitterless Login surface in the fixed Home
  tab and never shows the Mini Apps list first.
- A valid saved session restores into Mini Apps; a temporary recovery failure preserves the session
  and exposes the existing retry/cancel/switch-account controls.
- Password login, OTP login, reset password, and invited-account password setup all converge on the
  authenticated Mini Apps surface.
- Logout and authentication invalidation return the fixed Home to Login while the legacy Home
  `BrowserWindow` remains hidden.
- Source tests prove the strict snapshot parser, no-token bridge boundary, subscribe-before-read
  bootstrap, authenticated-content fail-closed rule, and reuse of one Login surface.
- Ral performs Electron/runtime and visual E2E acceptance.

Implementation task:
[maestro-local-home-auth-gate-096](../plan/tasks/maestro-local-home-auth-gate-096.md).

## Resolution

- The fixed Home now fails closed until it receives a strictly parsed, token-free authentication
  snapshot from the hidden Home authority. Signed-out users see the existing Login surface; only an
  active, password-complete session mounts the Mini Apps workspace.
- The hidden Home remains the sole token, device/session, authentication-request, Todo-readiness,
  and authenticated-runtime owner. Fixed Home uses addressed XPC commands and never persists a
  credential in the Maestro partition.
- Authority epochs plus monotonic revisions reject stale reads, broadcasts, and command results.
  Malformed broadcasts immediately hide authenticated content and start a bounded 4.25-second
  authoritative refresh.
- The one shared Login surface retains password/OTP login, reset, first-password setup, saved-session
  recovery, retry, cancellation, and account switching. Legacy Home and fixed Home use separate
  adapters so fixed-Home navigation has one owner and never targets `/chat`.
- Focused regressions passed 14/14, the debug build and Node typecheck passed, and
  [independent review 1](../plan/reviews/maestro-local-home-auth-gate-096-1.md) approved the final
  source with no unresolved P0-P2 findings. Electron/runtime visual E2E remains with Ral.
