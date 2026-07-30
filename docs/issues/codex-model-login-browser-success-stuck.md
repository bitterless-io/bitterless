# Codex Browser Login Succeeds but Setting Keeps Waiting

Status: Implementing

Implementation:
[model-provider-fresh-login-callback-009](../plan/tasks/model-provider-fresh-login-callback-009.md)

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

## Required behavior

- Modern `ModelRuntime` browser login exclusively owns the OAuth callback server. The legacy
  companion callback is created only when the runtime is unavailable and the storage login API is
  used.
- Bitterless supplies Pi-compatible memory and locked-file credential stores instead of calling the
  removed `AuthStorage` export. The file format and `.lock` path remain compatible with Pi's
  default persistent runtime store.
- Status, logout, and login-only runtime instances disable model-network refresh.
- Every explicit Login removes the previous persistent `openai-codex` credential before the auth
  URL opens, then promotes only the current attempt's new in-memory credential after success.
- Cancel and replacement generations continue to abort or ignore late results. A cancelled attempt
  cannot promote a credential or overwrite a newer login.

## Acceptance

- A simulated modern callback-owned login resolves without creating a companion capture.
- The old persistent credential is deleted before the modern login/auth URL, and the attempt store
  starts empty.
- Every authentication-only `ModelRuntime.create()` call sets `allowModelNetwork: false`.
- Legacy browser login still uses and closes the companion callback.
- Existing login cancellation, retry, provider, i18n, type, and diff checks pass.
