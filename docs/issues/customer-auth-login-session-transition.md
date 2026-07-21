# Customer authentication does not complete in the current window

状态：客户端修复与上海生产端点切换已实现；人工验证待完成

Implementation: [customer-auth-login-account-001](../plan/tasks/customer-auth-login-account-001.md)

## Report

A reported production customer account exposes two distinct symptoms:

1. Password login is rejected by Core.
2. Email-code login succeeds at Core but stays on the login page; hiding and reopening the Home
   window later reveals the authenticated workspace.

The reported account identifier and credentials are intentionally excluded from this repository.

## Production endpoint decision

`yarn dev:prod` runs `rig --env debug_prod`. Its generated profile, renderer fallback, CSP,
main-process test allowlist, and Todo PowerSync connector now use the Shanghai `bitterless$prod`
Function Compute public endpoint directly:

`https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run`

The switch follows the completed Shanghai release gate: the function must authenticate with a
complete, independently verified public DSH `DATABASE_URL`, that exact target must pass migration
audit, and the current Core build and public health/authentication smoke checks must pass. Replacing
only the hostname in the private DSH URL remains explicitly invalid because that synthesized
connection already failed authentication. VPC migration remains deferred until after the public
path is stable.

## Confirmed root cause

Sanitized Hong Kong request logs distinguish the two paths. The reported password requests returned
HTTP 401 from Core, so those attempts were genuine credential/account rejection and are not caused
by desktop runtime activation. The email-code request returned success and was immediately followed
by a successful `/auth/me`; its visible stall occurs after Core authentication.

`AuthStore.activateToken()` validates `/auth/me`, persists the token, and assigns the current
customer before awaiting `AuthHandler.activateSession`. Main then serially awaits Core SQLite,
EyesOnAgents, Maestro, and Coin preparation. These local runtimes are not part of Core credential
validation and some have unbounded or long startup paths.

Consequences:

- a slow local runtime keeps `Login.onSubmit()` from reaching its route transition even though the
  authenticated token is already durable;
- a local runtime rejection enters the credential catch path, clears the valid token, calls Core
  logout, and is displayed as a generic login failure;
- reopening Home can appear to fix email-code login because the saved token is restored after the
  delayed local activation eventually settles;
- `router.replace()` is not awaited, so a failed or incomplete transition is not observable by the
  submit flow;
- login submission can overlap initial session restoration because it is gated by `loading` but not
  by `checking`.

Password login also retains a documented two-request compatibility bridge for canonical device IDs.
This repair keeps that device contract and ensures only Core login or `/auth/me` failures are treated
as authentication failures. Restoring password access for the reported account remains a Core
account-lifecycle operation (invitation/first-password setup when eligible, otherwise password
recovery); it is separate from the desktop navigation defect.

## Required correction

1. Commit an active Core session after login and `/auth/me` succeed. Optional local runtime
   activation runs asynchronously and can never revoke or mislabel that valid session.
2. Await the Vue Router replacement for password login, email-code login, restored sessions, and
   first-password completion. Login and restore must not overlap. If routing fails after Core has
   accepted the first password, the retry must perform navigation only.
3. Add a flat **Account** section under Settings → General that shows the authenticated email and a
   loading-aware Logout action.
4. Manual Logout clears local authentication immediately, routes to Login, best-effort revokes the
   server token, and invokes a dedicated silent Main teardown for authenticated secondary windows
   and runtimes. It must not show the "session invalidated" warning or keep the Login form disabled
   while a remote cleanup is stalled. Stale activations stop without starting an untracked second
   teardown.
5. Remove the visible login-panel border and the small `Bitterless` eyebrow. Keep the main login
   heading and use surface color, spacing, and restrained shadow for hierarchy.

## Acceptance

- Both password and email-code Core success reach the intended route in the same visible Home
  session without waiting for SQLite, EyesOnAgents, Maestro, or Coin preparation.
- A rejected optional runtime activation does not clear the Core token or display a credential
  failure.
- Session restoration cannot overlap a new login submission and clear its newer session.
- General shows the current account email and Logout.
- Logout reaches `/login` even when Core logout or Main teardown fails, and authenticated secondary
  windows receive the silent teardown request.
- A route failure after first-password success offers a navigation-only retry and never submits the
  password mutation twice.
- Login has no panel border, no left accent edge, and no small `Bitterless` eyebrow.
- `dev:prod`, the production renderer and Todo PowerSync fallbacks, CSP, and the main-process
  production-origin allowlist all use the Shanghai public FC endpoint.
