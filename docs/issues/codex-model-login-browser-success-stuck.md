# Codex Browser Login Succeeds but Setting Keeps Waiting

Status: Implemented in production `0.0.65`; owner must restore the macOS default web browser

Implementation:
[model-provider-fresh-login-callback-009](../plan/tasks/model-provider-fresh-login-callback-009.md)
[model-provider-loopback-diagnostics-011](../plan/tasks/model-provider-loopback-diagnostics-011.md)
[codex-production-login-recovery-012](../plan/tasks/codex-production-login-recovery-012.md)

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

## 2026-08-03 production recurrence

Packaged production `0.0.64` (`version_code=260802151913`) recorded two browser-login attempts in
`~/Library/Logs/Bitterless/main.log`. Both created the Pi runtime and timed out after three minutes
without callback, token-exchange, credential, promotion, or verification evidence. Inspection of
the installed ASAR confirms that this release contains the old `callback-listener-ready owner=pi`
flow and omits the accepted IPv4 ownership probe plus macOS IPv6 companion.

Pi 0.80.10 advertises `http://localhost:1455/auth/callback` but binds its server only to
`127.0.0.1`. On the affected macOS host, `localhost` resolves `::1` before IPv4, so the browser can
complete the remote authorization page without delivering the callback to Pi's listener.

Production `0.0.65` (`version_code=260803110507`) restores the accepted dual-stack callback flow on
the latest production release base. Owner verification shows that both listeners pass
current-process ownership checks and that the OpenAI authorization URL reaches
`authorization-url-opened`.

## 2026-08-03 browser presentation failure

On the affected Mac, LaunchServices registered `com.jetbrains.webstorm` as the handler for both
`http` and `https` on 2026-07-31 at 15:59:49. Electron's `shell.openExternal()` therefore reports a
successful handoff while sending the OpenAI authorization URL to WebStorm instead of a browser.

The application already delegates OAuth URLs to the system default URL handler through Electron's
`shell.openExternal()`. `http`/`https` URL-scheme ownership is independent from WebStorm's expected
`html`/`yml`/`md` file associations. The affected Mac must restore both URL schemes to the owner's
preferred default browser; Bitterless must not override that preference in application code.

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
- OAuth URLs are opened with the system default handler. Bitterless does not select a browser or
  alter system URL-scheme associations.

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

## 2026-08-20 recurrence — root cause found: companion teardown wedges the succeeded login

Status of this section: fixed; owner re-verification pending.

Reported as "Cancel does nothing, the button spins forever". Triage showed cancel was the second
symptom, not the origin — see
[Codex model login cannot be cancelled](codex-model-login-cancel-regression.md).

### Evidence

`Bitterless_DEBUG_PROD/logs/main.log`, attempt 1 at 2026-08-20T02:19Z, with the login lifecycle
fully instrumented:

```text
02:19:25.085  callback-listener-verified   localhost=ipv6:404 ipv4=ipv4:404 ipv6=ipv6:404
02:19:33.566  callback-request-received    family=ipv6 path=/auth/callback hasCode=true hasState=true
02:19:33.569  callback-response-sent       family=ipv6 status=200
02:19:33.570  callback-forwarded-to-pi     owner=bitterless family=ipv6
02:19:35.146  token-exchange-response      status=200
02:19:35.164  token-credential-stored      stored=true
02:19:35.165  promotion-completed
02:19:35.169  status-verification-resolved connected=true unavailable=false
02:19:35.170  attempt-succeeded
02:19:35.171  cleanup-capture-closing      <- last line for this attempt
```

`cleanup-capture-closing` occurs once in the file. `cleanup-capture-closed` and
`attempt-cleanup-completed` occur zero times, while the process kept logging for another 92 seconds
(UpdateService at 02:20:21, shutdown at 02:21:07).

`localhost=ipv6:404` also records why the IPv6 path is the live one on this machine: `localhost`
resolves to `::1` first, so the browser follows Pi's announced `localhost:1455` URL to the
Bitterless companion rather than to Pi's IPv4 listener.

### Root cause

The login fully succeeds — token exchanged, credential stored, promoted, and verified
`connected=true` — and then `performConnect`'s `finally` blocks forever on `await capture.close()`.
`credentials.connect()` therefore never settles, `ModelProviderService.connect()` never commits
`ready`, and Setting and Translator sit on `Waiting for Codex sign-in…` with a working credential
already on disk.

`CodexBrowserCallbackCapture.close()` wrapped `server.close()` alone. Measured on Node 24:

| connection state left by the client | `server.close()` callback |
|---|---|
| idle keep-alive after a completed response | fires in ~0 ms |
| request sent, response never written | never fires |
| headers started, never terminated | never fires |

Node ≥ 19 closes *idle* connections on `server.close()`, which is why an isolated probe never
reproduced it; a connection that is mid-request or awaiting a response is held instead.
`server.closeAllConnections()` clears both wedged states in ~0-2 ms.

### Repair

`close()` now forces connections shut and cannot outlive a deadline:

- `server.closeAllConnections()` after `server.close()`, so a held browser socket cannot pin the
  listener.
- `CODEX_CALLBACK_CLOSE_TIMEOUT_MS` (2 s) backstop that resolves `close()` and reports
  `close-timeout` through `onUnavailable`, so teardown can never again hold a promoted credential.
- `port` and `closeTimeoutMs` options so the real capture is testable.
- `performConnect`'s `finally` now logs `cleanup-capture-closing` / `cleanup-capture-closed`,
  `cleanup-authorization-awaiting` / `cleanup-authorization-settled`, and
  `cleanup-promotion-reverting` / `cleanup-promotion-reverted`, so any future stall in cleanup names
  itself instead of ending the log.

### Not the cause: two different ChatGPT accounts

The owner's local `codex` CLI was signed into account A while the Bitterless browser flow selected
account B. That mismatch did not cause this hang: the log shows account B's login succeeding end to
end, and the two credentials never share a file — the CLI uses `~/.codex/auth.json`, Bitterless uses
`<userData>/cowork/pi/auth.json` (`codexPaths.ts`).

It does expose a real gap: no surface anywhere names the connected account. `ModelProviderRecord`
carries no account identity, so Setting shows only `Codex connected` and Translator shows only
`Codex · GPT-5.5 · low`. Tracked separately in
[Connected Codex account is not identified](codex-connected-account-not-identified.md).
