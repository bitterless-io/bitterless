# Codex Browser Login Succeeds but Setting Keeps Waiting

Status: Active; production `0.0.65` reaches browser launch but macOS routes it to WebStorm

Implementation:
[model-provider-fresh-login-callback-009](../plan/tasks/model-provider-fresh-login-callback-009.md)
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

Codex OAuth on macOS must explicitly target an installed real browser: Google Chrome first and
Safari as the built-in fallback. Other platforms retain the existing system external-URL opener.

## Required behavior

- Modern `ModelRuntime` owns the IPv4 OAuth callback server. On macOS, Bitterless owns an
  attempt-local IPv6 companion on `::1:1455`; an IPv6 redirect is returned only through the same
  Pi login's `manual_code` prompt. Pi remains the only token-exchange and credential owner.
- Bitterless supplies Pi-compatible memory and locked-file credential stores instead of calling the
  removed `AuthStorage` export. The file format and `.lock` path remain compatible with Pi's
  default persistent runtime store.
- Status, logout, and login-only runtime instances disable model-network refresh.
- Every explicit Login removes the previous persistent `openai-codex` credential before the auth
  URL opens, then promotes only the current attempt's new in-memory credential after success.
- Cancel and replacement generations continue to abort or ignore late results. A cancelled attempt
  cannot promote a credential or overwrite a newer login.
- Before opening the browser, Main proves that the current process owns Pi's IPv4 listener and the
  required macOS IPv6 companion. Missing, foreign, or unexpected listeners fail immediately.
- On macOS, browser OAuth targets Chrome explicitly when available and Safari otherwise, so an IDE
  registered as the default URL handler cannot swallow the authorization page.

## Acceptance

- A simulated modern browser login resolves through Pi IPv4 or the macOS IPv6 companion while Pi
  remains the only exchange and credential owner.
- The old persistent credential is deleted before the modern login/auth URL, and the attempt store
  starts empty.
- Every authentication-only `ModelRuntime.create()` call sets `allowModelNetwork: false`.
- Legacy browser login still uses and closes the companion callback.
- Existing login cancellation, retry, provider, i18n, type, and diff checks pass.
