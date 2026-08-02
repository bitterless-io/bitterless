---
id: customer-auth-session-recovery-002
scope: durable customer session recovery across desktop restart and transient Core failures
status: implemented; owner verification pending
depends-on: [customer-auth-login-account-001]
---

# Customer Session Recovery

## Objective

Keep a valid persisted customer token across computer and application restarts when Core cannot be
reached temporarily, while retaining server-authoritative invalidation and preventing unverified
access to protected routes.

## Context

- [Customer authentication](../../design/customer-authentication.md)
- [Restart session loss](../../issues/customer-auth-restart-session-loss.md)
- [Customer login transition](customer-auth-login-account-001.md)

## Required behavior

- Represent HTTP authentication failures with their status so session restoration can distinguish
  an authoritative `401` from transport errors and non-authoritative HTTP failures.
- Treat an explicitly ineligible customer payload as authoritative invalidation.
- Validate the complete `/auth/me` customer contract before assigning `current`; a malformed `200`
  response is retryable and never authorizes a protected route.
- `AuthStore.fetchMe()` and new-token validation clear local authentication only for authoritative
  invalidation. A transient failure leaves the same token and installation device ID untouched.
- Persist a newly issued password/OTP token before `/auth/me` validation so a transient validation
  failure enters the saved-session recovery state immediately.
- Validate the password/OTP success payload before persisting any returned token.
- Bound the full HTTP response lifecycle, including body parsing, and support explicit abort.
- Canceling recovery preserves the token; only the distinct Use another account action clears it.
- Attach a random identity to each persisted token generation and ignore invalidation events for an
  older identity.
- Router and Login never add unconditional token cleanup around `restoreSession()`.
- A saved token that cannot currently be validated opens a recovery state instead of the credential
  form. Retry uses the same saved token; using another account is an explicit destructive action.
- Protected routes remain gated until `/auth/me` validates the customer.

## Path

- `docs/INDEX.md`
- `docs/design/customer-authentication.md`
- `docs/issues/customer-auth-restart-session-loss.md`
- `docs/plan/README.md`
- `docs/plan/tasks/customer-auth-session-recovery-002.md`
- `scripts/auth/customer-authentication.test.mjs`
- `src/renderer/home/src/networking/auth.api.ts`
- `src/renderer/home/src/router/index.ts`
- `src/renderer/home/src/stores/auth/auth.store.ts`
- `src/renderer/home/src/stores/auth/authSession.service.ts`
- `src/renderer/home/src/stores/auth/authToken.service.ts`
- `src/renderer/home/src/xpc/auth.subscriber.ts`
- `src/main/xpc/auth.handler.ts`
- `src/shared/auth/auth.type.ts`
- `src/renderer/home/src/views/login/Login.vue`
- `src/renderer/home/src/views/login/Login.less`

## Verification

- `yarn test:customer-auth`
- `yarn check:renderer-i18n`
- `yarn typecheck:web`
- `git diff --check`
- Executable tests cover complete customer/login payload validation, full-operation timeout,
  explicit cancellation, session-identity fencing, and new-token transient/authoritative failure.
- Source review confirms there is no protected-route bypass and no token, credential, or customer
  payload is written to diagnostics.

## Delivery evidence — 2026-08-02

- Implemented complete auth payload validation, persisted-token retry recovery, bounded request
  cancellation, session-identity fencing, and a final protected-route gate.
- `yarn test:customer-auth` passed 20/20, `yarn check:renderer-i18n` passed, targeted ESLint passed,
  `git diff --check` passed, and `yarn build` completed successfully.
- Full Web typecheck retains unrelated existing diagnostics outside the changed authentication
  modules. Ral retains restart/offline and visible recovery-state acceptance.
