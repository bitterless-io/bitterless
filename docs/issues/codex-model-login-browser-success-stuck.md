# Codex Browser Login Succeeds but Setting Keeps Waiting

Status: Reopened; loopback ownership diagnostics in progress

Implementation:
[model-provider-fresh-login-callback-009](../plan/tasks/model-provider-fresh-login-callback-009.md)
[model-provider-loopback-diagnostics-011](../plan/tasks/model-provider-loopback-diagnostics-011.md)

## Symptom

Setting → Model Config opens the Codex browser login and the web page reports success, but
Bitterless remains at `Waiting for Codex sign-in…` instead of becoming ready. A prior local
credential can also affect what should be an explicit replacement Login.

## Root cause

The Pi `ModelRuntime` browser OAuth flow owns `localhost:1455` and waits for its own callback
server. Bitterless starts the legacy `CodexBrowserCallbackCapture` on the same port before it knows
whether the modern runtime is available. Either listener can receive the redirect, so the browser
can show success while the runtime promise that Main awaits never receives the authorization code.

Two secondary behaviors lengthen or contaminate the attempt:

- the pinned Pi 0.80.10 module no longer exports the legacy `AuthStorage`, while the partially
  migrated credential service still calls `AuthStorage.inMemory()` and `AuthStorage.create()`;
- the authentication-only `ModelRuntime` uses its default network catalog refresh, so browser
  completion can remain blocked behind unrelated model-network work;
- Login creates an isolated in-memory attempt store, but does not first remove the previous
  persistent provider credential, so an explicit reconnect is not guaranteed to start from a clean
  app credential state.

## 2026-07-31 recurrence

Translator reproduced the same user-visible failure after the browser rendered the OAuth success
page. The running development process had neither an application `main.log` nor any
`[codex-login]` lifecycle line in its attached terminal, so the completed callback, token exchange,
credential write, and status-verification boundaries could not be distinguished after the fact.

The pinned Pi 0.80.10 callback implementation has two loopback boundaries:

- its redirect URI is `http://localhost:1455/auth/callback`, while its callback server binds only
  `127.0.0.1`;
- failure to bind that IPv4 address resolves to an inert callback object instead of rejecting login.

On the affected macOS host, `localhost` resolves `::1` before `127.0.0.1`. The old Bitterless
companion listener covered `::1` and returned that redirect through Pi's `manual_code` prompt, but
the modern-flow ownership fix removed the companion entirely. The browser can therefore fail on
IPv6 before reaching Pi's IPv4 server. A concurrent or stale Bitterless/Codex process can also
serve a success page while the current login promise receives no authorization code.

## Required behavior

- Modern `ModelRuntime` owns the IPv4 OAuth callback server. On macOS, Bitterless owns an
  attempt-local IPv6 companion on `::1:1455`; if it receives the redirect, it returns the complete
  redirect only to Pi's same-attempt `manual_code` prompt. The companion never exchanges or stores
  credentials itself.
- Bitterless supplies Pi-compatible memory and locked-file credential stores instead of calling the
  removed `AuthStorage` export. The file format and `.lock` path remain compatible with Pi's
  default persistent runtime store.
- Status, logout, and login-only runtime instances disable model-network refresh.
- Every explicit Login removes the previous persistent `openai-codex` credential before the auth
  URL opens, then promotes only the current attempt's new in-memory credential after success.
- Cancel and replacement generations continue to abort or ignore late results. A cancelled attempt
  cannot promote a credential or overwrite a newer login.
- Before opening the browser, Main proves current-attempt loopback coverage: Pi's IPv4 listener
  belongs to the current Main process, and the macOS IPv6 companion is listening. A missing or
  foreign IPv4 listener, an unavailable required IPv6 companion, or an unexpected probe response
  fails the attempt immediately instead of waiting for the browser timeout.
- Pi IPv4 completion cancels the pending companion prompt; companion IPv6 completion resolves that
  prompt into the same Pi login. Cancel, timeout, replacement, and either success path close both
  listener resources.
- Main observes the current-process callback request and response without logging query values. It
  records only lifecycle stage, HTTP method/path, `hasCode`, `hasState`, and response status.
- The persistent log distinguishes listener announced, listener verified, callback received,
  callback response, token exchange, credential storage, promotion, verification, failure, and
  cleanup. Authorization codes, state values, URLs with query/hash, tokens, and credentials never
  enter logs.

## Acceptance

- A simulated modern browser login resolves through either Pi IPv4 or the macOS IPv6 companion
  while Pi remains the only exchange and credential owner.
- The old persistent credential is deleted before the modern login/auth URL, and the attempt store
  starts empty.
- Every authentication-only `ModelRuntime.create()` call sets `allowModelNetwork: false`.
- Legacy browser login still uses and closes the companion callback.
- Existing login cancellation, retry, provider, i18n, type, and diff checks pass.
- With a foreign process owning port 1455, Login fails before opening the browser and the log names
  the callback-listener ownership failure.
- On macOS, both a redirect delivered to `127.0.0.1` and one delivered to `::1` complete the same
  Pi login attempt.
- With the current Main process owning the required loopback listeners, the browser opens only
  after the ownership checks, and the log shows callback receipt through final credential
  verification.
