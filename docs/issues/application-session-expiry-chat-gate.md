# 应用会话过期后聊天仍沿用已登录快照

Status: implemented; awaiting Ral's app testing · 2026-09-24 · Paired with `micromeet-cowork`

## Contract and evidence

Ral requires anonymous browsing to remain usable while Control shows application login whenever
the application account is signed out, logs out, or expires. Every provider, including Codex and
custom providers, requires a valid application account. Provider credentials cannot bypass this gate.

`ApplicationAuthService.requireReady()` previously refreshed only the hidden Home snapshot.
`HomeShellBridgeHandler.getAuthSnapshot()` reads the saved token and previously loaded customer;
it does not revalidate with Core. A Codex/custom-provider conversation can therefore outlive a
revoked/expired application session. Auth API 401 handling exists, but requires an auth request.

## Repair

- Revalidate the application session with its existing authority before new chat work, independently
  of provider choice. Concurrent checks share one bounded request; account/logout generations fence
  stale success and failure. Never copy credentials into Control or expose them in errors.
- Recheck an authenticated session every 60 seconds while the application runs, so expiry is detected
  without another BL API action. Stop/release the timer with its owner. Successful background checks
  must not unmount chat or reset conversations.
- Confirmed invalidation clears the exact current session, revokes active chat, broadcasts the new
  state and returns Control to login. Preserve ordinary browser tabs and public local tools.
- Network/timeouts/server failures retain saved credentials; a failed send-time verification cannot
  start model work. Preserve the existing retry/recovery flow instead of calling outages logout.
- Keep manual logout and normal login transitions working; old responses cannot reauthenticate or
  clear a replacement account. Provider-only credential errors are not application logout.

## Verification and handoff

Exercise real auth logic with mocked transport: anonymous browsing, all-provider preflight, current
session rejection, successful quiet checks, transient failure, periodic detection, logout/account
replacement races and timer cleanup. Run scoped type/source checks. No Electron E2E or independent
review; Ral will test browser + login/chat + logout + expired-session transitions in the app.

The separate `control-login-form-192` visual alignment remains outside this expiry repair.

## Delivery — 2026-09-24

- `ApplicationAuthService.requireReady()` now performs a bounded live check through Home before
  every claim/send, for every provider. Concurrent callers share validation; generation checks
  also run after runtime resume and after the reply. Snapshots carry a non-secret local session ID
  so signing back into the same email cannot reuse an earlier account generation.
- Home validates through the existing `/auth/me` API without setting `checking` or `loading`.
  A healthy check therefore keeps Control/chat mounted. An authenticated-only 60-second timer
  catches idle expiry and is cleared on logout or Home unload. The existing API deadline is
  20 seconds; Main bounds an unavailable authority at 22 seconds.
- Confirmed expiry or disabled-account rejection clears the matching account and suspends protected
  work while retaining browser/public tabs. Transient failures keep credentials and the current chat
  visible, but the attempted new send fails. Late validation, clear-session and deferred deactivation
  cannot clear a replacement identity.
- Core web-search and decision-relay 401s, plus Bitterless-provider runtime errors, trigger live
  validation only for the captured current token/session. Upstream/provider failures never directly
  log the application account out.

Code verification:

- Focused executable auth/lifecycle/account/provider checks: **42/42 pass**, including the eight new
  tests in `tests/maestro/applicationSessionValidation.test.mjs`. The periodic test runs the real Home
  handler and AuthStore with mocked transport/clock; the lifecycle tests exercise the Main authority.
- `scripts/auth/customer-authentication.test.mjs`: **18/20 pass**. The two pre-existing failures remain
  the production endpoint occurrence-count assertion and Todo error-copy source assertion.
- Decision-maker and logout checks: **35/35 pass**. Broader Pi adapter/queued-steering checks stop at
  an existing fixture dependency gap for `@main/net/downloadManager` in `hostToolExecution.ts`;
  no unrelated harness or source changes were made for it.
- Scoped `yarn tsc` for Main auth/contracts/customer-session and `yarn vue-tsc` for Home AuthStore pass.
  Whole Main/Home surface checks are not clean because of existing unrelated diagnostics (including
  Pi session snapshot type overlap, OnlyPreview presentation fields and legacy Home chat types).
- No Electron launch, E2E, live credentials or independent review was used.

Ral's app test: start signed out and browse/open/close left tabs; sign in and chat with Codex and a
custom provider; sign out during a reply and confirm Control returns to login with tabs retained;
expire/revoke the current application session and confirm both immediate send and idle detection
(the next 60-second check plus network response) return to login. Also leave a healthy signed-in chat
idle through a check and confirm its messages/composer stay mounted.
