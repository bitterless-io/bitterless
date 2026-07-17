# Customer Authentication

## Purpose and boundary

This document defines the Bitterless desktop login, account-recovery, and first-password contracts.
Core owns credential and account-state validation. The desktop renderer owns form validation,
session activation, and the modal/page transitions described here.

## Account lifecycle

| Status | Meaning | Desktop behavior |
|---|---|---|
| `invited` | The account exists but has not completed first-password setup | A valid login creates only a restricted session and always opens the unclosable first-password modal |
| `active` | Normal customer account | Password or email-code login enters the workspace |
| `inactive` | Access has been disabled | Password login, OTP login, password recovery, restored JWTs, and worker activation are blocked |

`status` is the lifecycle source of truth. `has_password` describes credential presence, while
`must_set_password` is the server-provided navigation guard for an invited session. The renderer
also treats `status === "invited"` or a missing password as requiring setup so a stale flag cannot
open the workspace.

An invited account is authenticated only with a valid credential. A newly invited account without
a password must use email-code login. A re-invited account that still has a valid legacy password
may use it, but the resulting session remains restricted and the password must be replaced.

## Shared window shell

The application owns one window-level shell above routing. `MenuBar` is rendered once by `App.vue`
for both public and authenticated routes, so window dragging, platform window controls, proxy status,
and the restart-to-update action do not disappear while the customer is logged out. Route pages own
only the content region below that bar.

```text
┌──────────────────────── shared MenuBar (32px) ────────────────────────────┐
│ Bitterless             [Restart to Update] [Proxy]      [window controls] │
├──────────────────────── routed content region ────────────────────────────┤
│ /login                                /chat and authenticated routes       │
│ Login content only                    HomeMenu + workspace content         │
└────────────────────────────────────────────────────────────────────────────┘
```

`/login` remains a public route for authentication guards and redirects, but it is not a separate
window-chrome layout. It must not add its own full-window drag overlay because that would cover the
shared menu bar's clickable update and window controls.

## Login and recovery layout

```text
┌──────────────────────── shared Royal Blue MenuBar ───────────────────────┐
│ Bitterless                                  [Restart to Update] [controls]│
├──────────────────── light Royal Blue login surface ─────────────────────┤
│        ┌─ Royal Blue account panel ─────────────────────────────┐         │
│        │ Bitterless                                             │         │
│        │ [Password login] [Email code]                          │         │
│        │ Email                                                  │         │
│        │ Password                           [Forgot password?]   │         │
│        │ [Sign in]                                             │         │
│        └────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────┘

Forgot password                    Invited first login
┌──────────────────────────────┐    ┌──────────────────────────────┐
│ Reset password               │    │ Set login password           │
│ Email                        │    │ invited@example.com          │
│ Code            [Send code]  │    │ New password                 │
│ New password                 │    │ Confirm password             │
│ Confirm password             │    │ [Set password and continue]  │
│ [Reset password]             │    └──────────────────────────────┘
└──────────────────────────────┘    cannot close by X/mask/Escape
```

## Interaction contract

| Action | Contract |
|---|---|
| Password login | Authenticate, fetch `/auth/me`, then activate workers only for an active account |
| Email-code login | Authenticate with purpose `login`; invited opens first-password setup, active enters the workspace |
| Forgot password | Open a closable modal without creating an authenticated desktop session |
| Send reset code | Send an email OTP with purpose `reset_password`; disable duplicate submission during the request and cooldown |
| Reset password | Require two matching inputs of at least eight characters, reset through the dedicated unauthenticated endpoint, then return to password login |
| First-password setup | Require two matching inputs of at least eight characters; keep the modal open on error |
| Update available while logged out | Show the same `Restart to Update` action as the authenticated workspace; clicking it calls the existing update restart flow |
| Window controls while logged out | Keep the shared macOS drag region or Windows minimize/maximize/close controls interactive above the login content |

All request buttons expose a loading state and block re-entry. Reset-password completion never logs
the customer in automatically; the customer signs in with the new password. Restoring an inactive
or otherwise invalid session clears the local token before any authenticated worker is activated.

## Visual contract

- The complete native window, `html`, `body`, `#app`, and login surface use Royal Blue light
  surfaces. No transparent or near-black area may appear during first paint, resizing, or routing.
- Primary actions use `royalblue-600` (`#4E5882`), hover uses `royalblue-500` (`#606B9D`), and
  pressed uses `royalblue-800` (`#323955`).
- Login and account modals use `royalblue-50`, white, and `royalblue-200` surfaces/borders.
- The account panel's narrow Royal Blue edge is the page signature; other decoration remains quiet.
- At the `800x600` minimum window size, each modal remains fully reachable and owns its internal
  scrolling when necessary.
- The 32px shared `MenuBar` is the only window-chrome layer. Login content fills the remaining
  routed-content height and never overlays the bar's no-drag actions.

## Entry points

- `src/renderer/home/src/views/login/Login.vue`
- `src/renderer/home/src/views/login/Login.less`
- `src/renderer/home/src/App.vue`
- `src/renderer/home/src/App.less`
- `src/renderer/home/src/components/MenuBar/MenuBar.vue`
- `src/renderer/home/src/stores/auth/auth.store.ts`
- `src/renderer/home/src/networking/auth.api.ts`
- `src/renderer/home/src/router/index.ts`
- `src/main/windows/mainWindow.helper.ts`
