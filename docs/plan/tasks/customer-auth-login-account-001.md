---
id: customer-auth-login-account-001
scope: deterministic customer login transition, General account identity, and manual logout
status: implemented; backend gate and owner verification pending
depends-on: [customer-account-recovery, login-shared-window-shell]
---

# Customer Login Transition And Account Controls

## Objective

Separate successful Core authentication from optional local runtime startup so password and
email-code login navigate immediately in the current Home window. Add the authenticated account and
manual Logout to Settings → General, and simplify the login surface as requested.

## Context

- [Customer authentication](../../design/customer-authentication.md)
- [Login session transition issue](../../issues/customer-auth-login-session-transition.md)
- [Run desktop development against production](dev-prod-core-api.md)
- [Customer account recovery](customer-account-recovery.md)
- [Shared login window shell](login-shared-window-shell.md)

## Layout

```text
Login                                  Settings → General
┌─────────────────────────────┐        ┌───────────────────────────────┐
│ Log in to Bitterless        │        │ Display language              │
│ Account access description  │        │ Search engine                 │
│ [Password] [Email code]     │        │                               │
│ Email                       │        │ Account                       │
│ Password                    │        │ signed-in@example.test        │
│ [Log in]                    │        │ [Logout]                      │
└─────────────────────────────┘        └───────────────────────────────┘
  white surface, no outline             flat sections, no account card
```

## Required behavior

- After the Shanghai backend release gate passes, point `debug_prod`, `release_prod`, the renderer
  production fallback, CSP, and the main-process production-origin allowlist at
  `https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run`.
- Treat Core login plus `/auth/me` as the authentication boundary. Persist the validated session,
  schedule Main runtime activation without awaiting it, and never clear the session for a local
  activation failure.
- Prevent initial restore and submit from overlapping. Await every post-authentication
  `router.replace` before declaring the UI transition complete.
- Once first-password mutation succeeds, record completion before routing. A route failure exposes
  a navigation-only retry and must never submit the password mutation again.
- Keep the existing password device-ID compatibility bridge; authentication errors must arise only
  from its Core requests or `/auth/me`, not from local worker initialization.
- Add `AuthHandler.deactivateSession()` for manual logout. It reuses authenticated secondary-window
  cleanup without broadcasting a 401 warning.
- Manual logout clears local state synchronously, routes to Login immediately, and lets Core token
  revocation plus Main teardown settle in the background. Either cleanup may fail without restoring
  local authentication, blocking navigation, or indefinitely disabling the next login. Main owns
  one tracked teardown; a stale activation may stop itself but must not launch another teardown.
- General Account displays only the current authenticated email and a localized Logout button. It
  adds no bordered card.
- Delete the login eyebrow and both panel border declarations. Retain the main heading and existing
  Royal Blue surface hierarchy.

## Path

- `docs/INDEX.md`
- `docs/design/customer-authentication.md`
- `docs/issues/customer-auth-login-session-transition.md`
- `docs/plan/README.md`
- `docs/plan/tasks/customer-auth-login-account-001.md`
- `package.json`
- `scripts/auth/customer-authentication.test.mjs`
- `src/main/xpc/auth.handler.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/home/src/emitter/auth.emitter.ts`
- `src/renderer/home/src/stores/auth/authSession.service.ts`
- `src/renderer/home/src/stores/auth/auth.store.ts`
- `src/renderer/home/src/views/login/Login.vue`
- `src/renderer/home/src/views/login/Login.less`
- `src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue`
- `src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.less`
- `src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts`

## Verification

- Focused authentication contract checks cover the production endpoint, deferred/rejected local
  activation, awaited route transition, restore/submit exclusion, account identity, manual logout
  with rejected cleanup, stale-activation teardown ownership, first-password navigation-only retry,
  silent Main teardown, and the border/eyebrow removal.
- Renderer i18n source validation covers the new Account and Logout copy in English and Chinese.
- An independent verify agent reviews the implementation against this task and the issue/design
  contracts.
- Before the endpoint change is considered releasable, the Shanghai FC function must authenticate
  with a complete, independently verified public DSH `DATABASE_URL` and satisfy the backend
  deployment plan; replacing only the private URL hostname is invalid, the legacy Bitterless
  connection is not evidence for that target, and the desktop change must not lead the gate. VPC
  migration is a later release step after the public path works.
- Do not launch Electron for this task; final production-account confirmation belongs to Ral.

## Review

- Round 1: [customer-auth-login-account-001-1](../reviews/customer-auth-login-account-001-1.md)
  — accepted for source delivery after three review passes closed endpoint-gating, navigation,
  teardown ownership, background-cleanup, XPC typing, and first-password retry findings; backend
  release and Ral's runtime acceptance remain pending.
