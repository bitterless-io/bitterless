# Codex Model Login Cannot Be Cancelled

Status: Active

## Symptom

Setting → Model Config changes Codex to `authenticating` after Login, but exposes only a disabled,
loading Login button. If the browser OAuth flow is abandoned, the user cannot cancel it or start a
replacement login without restarting Bitterless.

## Root cause

The accepted Translator/model-provider contract and its regression test already require a
cancellable login, but the current runtime does not implement that contract:

- `ModelProviderApi` exposes `connect()` and `disconnect()` but no `cancelConnect()`.
- `CodexCredentialService` owns an attempt-local `AbortController` only inside
  `performConnect()`, so no caller can abort the active Pi login or callback capture.
- `ModelProviderService.connect()` is serialized behind the mutation queue and has no attempt
  generation. A normal cancel call would therefore wait behind the blocked login, and a late result
  from an older attempt could still commit `ready`.
- `llmSetting.store` owns no action generation. Its pending `connect()` completion can still update
  state after the user cancels or starts a replacement attempt.
- `LLMSetting.vue` renders `authenticating` as a disabled Login control instead of Cancel.

## Required behavior

```text
login_required / invalidated       authenticating                    cancelled
┌──────────────────────────┐       ┌──────────────────────────┐       ┌──────────────────────────┐
│ Codex needs login [Login]│ ────► │ Waiting…        [Cancel] │ ────► │ Codex needs login [Login]│
└──────────────────────────┘       └──────────────────────────┘       └──────────────────────────┘
                                               │
                                               └── late old result → ignored
```

- Cancel is available as soon as the local Login action starts, including before Main publishes the
  `authenticating` snapshot.
- Cancel aborts the active Pi login and browser callback capture without waiting for the normal
  login timeout.
- Cancel restores `login_required`, or preserves the preceding `invalidated` state, and permits an
  immediate replacement Login.
- Credential, provider, and renderer layers each fence attempts with an identity/generation. A
  cancelled or superseded attempt cannot promote a credential, commit `ready`, overwrite the new
  snapshot, clear a newer action, or show a late error.
- A successful result that races cancellation is removed before the provider publishes the
  cancelled state.
- A replacement login from another renderer does not suppress cleanup of the cancelled attempt and
  the cancelled attempt cannot overwrite the replacement's state. Cleanup failure stays fail-closed
  instead of publishing a successful cancellation that can later reconcile back to stale `ready`.

## Acceptance

- Setting displays localized `Cancel` during local or broadcast authentication state.
- Cancel returns the control to Login without restarting Bitterless.
- Login can be started again immediately after Cancel.
- A late completion from the cancelled attempt is ignored at every state-changing boundary.
- Cross-renderer replacement and credential-cleanup failure remain non-ready and observable.
- Existing model-provider cancellation tests, renderer i18n checks, touched type checks, and
  `git diff --check` pass.
