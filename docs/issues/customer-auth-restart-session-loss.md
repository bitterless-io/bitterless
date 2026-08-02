# Customer session disappears after computer restart

Status: implemented; owner restart verification pending

Implementation: [customer-auth-session-recovery-002](../plan/tasks/customer-auth-session-recovery-002.md)

## Report

A customer who has already signed in can restart macOS, reopen Bitterless, and be returned to the
credential form. Entering credentials again succeeds, but a computer restart must not itself end a
valid customer session.

## Confirmed root cause

The production renderer persists the Core JWT in Electron Local Storage under the stable
`Bitterless` runtime profile. Core issues both the JWT and its database token row for 30 days, and
desktop shutdown does not invoke customer logout.

On startup, Vue Router calls `AuthStore.restoreSession()`, which validates the persisted token with
`GET /auth/me`. The current `fetchMe()` catch path clears Local Storage for every rejection. Router
and Login repeat that unconditional cleanup. The networking layer throws the same ordinary `Error`
for an authoritative HTTP 401, an HTTP 5xx, and malformed responses, while native `fetch` failures
such as DNS, offline startup, and connection timeout also enter the same catch path.

The 2026-08-02 production startup log records DNS `ENOTFOUND` immediately after launch. Auth did not
log its own failed request, so the exact `/auth/me` transport error is not recoverable from that
log, but the observed cold-start network outage reaches the confirmed unconditional token-deletion
path.

## Required correction

1. Preserve the persisted token when `/auth/me` cannot be verified because of a transport failure,
   timeout, malformed/non-authoritative response, or HTTP 5xx.
2. Validate every required customer-session field before assigning the current customer. A partial
   `200` response must preserve the token for retry without opening protected content.
3. Persist a newly issued password/OTP token before `/auth/me` validation so a transient validation
   failure enters the same saved-session recovery state.
4. Clear the persisted token only after Core returns HTTP 401 or the complete validated customer
   payload is explicitly ineligible for a session.
5. Keep protected content closed while validation is unavailable. Present a session-recovery state
   that retries the saved token without requiring credentials, lets the customer cancel an active
   validation without deleting the token, and provides a separate explicit discard action.
6. Bound the complete request, including response-body parsing, and abort it on timeout or explicit
   cancellation so recovery cannot remain in a permanent loading state.
7. Fence cross-window HTTP 401 invalidation with a random session identity so a delayed response
   from an old token cannot clear a newly authenticated session.
8. Validate password/OTP success payloads before persisting their token.
9. Add executable regression coverage for payload validation, new-token recovery, timeout,
   cancellation, stale-session invalidation, and error classification plus source-level coverage
   for the Router/Login cleanup boundary.

## Acceptance

- Restarting while DNS, the network, or Core is temporarily unavailable does not remove the saved
  token.
- Retrying after connectivity returns restores the workspace without email, password, or OTP entry.
- HTTP 401 and an explicitly ineligible customer still clear the saved token and show normal login.
- Canceling an in-flight recovery keeps the token and exposes Retry / Use another account choices.
- No protected workspace route is opened before `/auth/me` succeeds.
- Production and debug runtime profiles remain isolated and unchanged.

## Delivery evidence — 2026-08-02

- The renderer now distinguishes authoritative rejection from retryable transport, timeout,
  response-body, and server failures; retryable recovery retains the current token.
- Password and OTP tokens are validated and persisted before `/auth/me`, while random session
  identities fence delayed invalidation from an older token generation.
- Recovery exposes separate Retry, Cancel, and Use another account behavior without allowing an
  unvalidated protected route.
- `yarn test:customer-auth` passed 20/20, targeted ESLint and renderer i18n passed, and the complete
  Electron build succeeded. Ral retains real restart, offline recovery, and visual acceptance.
