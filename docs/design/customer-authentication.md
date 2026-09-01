# Customer Authentication

## Purpose and boundary

This document defines the Bitterless desktop login, account-recovery, first-password, and manual
logout contracts. Core owns credential and account-state validation. The desktop renderer owns form
validation, durable local session commitment, immediate route transitions, and the account controls
described here. Optional local runtimes activate after authentication and never redefine whether
Core login succeeded.

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
and the compact update action do not disappear while the customer is logged out. Route pages own
only the content region below that bar.

```text
┌──────────────────────── shared MenuBar (32px) ────────────────────────────┐
│ Bitterless                         [update] [Proxy]     [window controls] │
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
│ Bitterless                                          [update] [controls]│
├──────────────────── light Royal Blue login surface ─────────────────────┤
│        ┌─ white account surface; no visible outline ────────────┐         │
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

Persisted session recovery keeps credentials out of the transient failure path:

```text
┌──────────────────────────────┐
│ Restore sign-in              │
│                              │
│ Saved session is being       │
│ validated...                 │
└──────────────────────────────┘
               │ temporary network/Core failure
               ▼
┌──────────────────────────────┐
│ Restore sign-in              │
│ Sign-in is saved             │
│ [Retry] [Use another account]│
└──────────────────────────────┘
```

The recovery surface never renders authenticated workspace content before `/auth/me` succeeds.
`Retry` reuses the same token. `Use another account` is the only recovery-state action that clears
the saved token and starts best-effort logout cleanup.

Workbench exposes account identity as an inner Settings category without adding another card or a
new top-level pane:

```text
┌──────────── Workbench → Settings ──────────────────────────────────────┐
│ General       │ Account                                                │
│ Account       │ Email                                                  │
│ LLM           │ signed-in@example.test                                 │
│ ...           │                                              [Logout]  │
└───────────────┴────────────────────────────────────────────────────────┘
```

## Interaction contract

| Action | Contract |
|---|---|
| Password login | Authenticate and fetch `/auth/me`; an active account enters the workspace immediately while local runtimes activate asynchronously |
| Email-code login | Authenticate with purpose `login`; invited opens first-password setup, while active enters immediately without waiting for local runtimes |
| Forgot password | Open a closable modal without creating an authenticated desktop session |
| Send reset code | Send an email OTP with purpose `reset_password`; disable duplicate submission during the request and cooldown |
| Reset password | Require two matching inputs of at least eight characters, reset through the dedicated unauthenticated endpoint, then return to password login |
| First-password setup | Require two matching inputs of at least eight characters; keep the modal open on mutation error; after mutation success, any route failure changes the modal to a navigation-only retry |
| Update available while logged out | Show the same compact `update` action as the authenticated workspace; clicking it calls the existing update restart flow |
| Window controls while logged out | Keep the shared macOS drag region or Windows minimize/maximize/close controls interactive above the login content |
| Logout | Clear local authentication and route/broadcast Login before deactivating authenticated runtimes; when invoked from Workbench, close it and reveal Maestro on the pinned fixed Home Login surface rather than a restored web/startup tab |

The desktop owns one installation-level `device_id`. If the persisted value is absent, it creates
and saves one before authentication; if present, it reuses it unchanged. Password login,
email-code login, restored sessions, and token issuance all send that same value. Customer identity
and login method never derive or replace `device_id`.

All request buttons expose a loading state and block re-entry. Reset-password completion never logs
the customer in automatically; the customer signs in with the new password. Restoring an inactive
or Core-rejected session clears only that still-current local token. A transport error, timeout, or
non-authoritative Core failure preserves the token and opens a retryable recovery state without
opening protected routes. A newly issued password/OTP token is persisted before `/auth/me`
validation so the same recovery path remains available when that validation fails transiently.
Initial restore and a new login submission cannot overlap.

A successful `/auth/me` HTTP status is not sufficient by itself. The desktop validates the complete
customer session payload (`id`, `email`, customer `scope`, supported `status`, `has_password`, and
`must_set_password`) before assigning `current`. A malformed payload preserves the unverified token
for retry but cannot open a protected route.

Logout cleanup is deliberately detached after local session removal. A stalled network revoke or
secondary-window teardown cannot keep the Login form disabled. Main serializes a new optional
runtime activation behind the tracked teardown; stale activations only stop and never initiate an
untracked teardown of their own.

Core login plus a successful `/auth/me` response is the desktop authentication commit point. Vue
Router replacement is awaited so completion means the requested route is visible. SQLite,
EyesOnAgents, Maestro, Coin, and other local runtime preparation starts after that commit and is not
awaited by navigation. A local runtime rejection is reported separately and cannot clear, revoke, or
mislabel the valid Core session as a credential failure.

The Home renderer statically loads the public Login route shell and the authenticated Layout plus
the experimental Chat route in its entry graph. Moving from `/login` to `/chat`, including immediately after
first-password setup, is an in-memory route switch and must not request `Layout.vue` or `Chat.vue`
from the development server at navigation time. Development lands on Chat; production lands on the
lazy-loaded Mini Apps route unless an explicit redirect is requested. Less-frequent Home routes may
remain lazy-loaded.

## Visual contract

- The complete native window, `html`, `body`, `#app`, and login surface use Royal Blue light
  surfaces. No transparent or near-black area may appear during first paint, resizing, or routing.
- Primary actions use `royalblue-600` (`#4E5882`), hover uses `royalblue-500` (`#606B9D`), and
  pressed uses `royalblue-800` (`#323955`).
- Login and account modals use `royalblue-50`, white, and `royalblue-200` surfaces where modal
  separation requires it.
- Login, recovery, and first-password fields remain Arco inputs with a visible 1px
  `royalblue-200` border. Hover strengthens the border, keyboard focus uses the primary Royal Blue
  border plus a restrained focus ring, and disabled/error fields retain distinct semantic states.
- The login panel has no visible outline or left accent edge. Its hierarchy comes from the white
  surface, restrained shadow, spacing, and the main login heading. The small `Bitterless` eyebrow is
  absent. No invited-account helper sentence appears below the heading; the login mode selector is
  the next control.
- Settings Account follows the page's existing flat section rhythm and adds no bordered card.
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
- `src/renderer/home/src/stores/auth/authSession.service.ts`
- `src/renderer/home/src/networking/auth.api.ts`
- `src/renderer/home/src/router/index.ts`
- `src/renderer/home/src/views/setting/components/AccountSetting/AccountSetting.vue`
- `src/renderer/home/src/views/setting/components/AccountSetting/AccountSetting.less`
- `src/main/windows/mainWindow.helper.ts`
- `src/main/xpc/auth.handler.ts`
