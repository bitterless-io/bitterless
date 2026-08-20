# Codex Model Login Cannot Be Cancelled

Status: Reopened 2026-08-20 — owner verification failed; cancel bounded and instrumented, stalled
step pending one repro log

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

## Resolution

Setting now exposes Cancel from the local login start, supports Reconnect, and fences credential,
provider, and renderer attempts. OAuth credentials stay attempt-local until the current generation
succeeds. Cleanup failure remains fail-closed and cannot reconcile to stale `ready`.

Independent verification passed after the cross-renderer cleanup and UI findings were corrected.
See
[model-provider-login-cancel-regression-007-1](../plan/reviews/model-provider-login-cancel-regression-007-1.md).

## 2026-08-20 recurrence — Cancel never returns

Owner verification of the resolution above failed. Repro: Setting → Model Config → Login, leave the
opened OAuth page untouched, then click Cancel. The Cancel button stays in its loading state
indefinitely; the login cannot be abandoned without restarting Bitterless.

### What the UI is actually showing

`LLMSetting.vue` binds the Cancel button's `:loading` to `llmSettingStore.action === 'cancel'`, and
`llmSetting.store.cancelLogin()` only clears `action` in its `finally`. The spinner is therefore an
exact readout of one fact: the `cancelConnect` XPC promise has not settled. It is not a rendering or
state-fencing defect.

### Ruled out by measurement

- **XPC does not serialize the two calls.** `electron-xpc` `send()` is one `ipcRenderer.invoke` per
  call and main dispatches `__xpc_exec__` per invocation, so `cancelConnect` is not queued behind
  the pending `connect`.
- **The IPv6 callback server is not holding cancel open.** `CodexCredentialService.cancelConnect()`
  awaits `capture.close()`, which wraps `server.close()`. Measured against the same server shape as
  `codexCallbackCapture.ts` on Node 24: `close()` resolves in ~0.1 ms with no connection, after an
  `agent: false` probe (what `verifyOwnership` issues), and even with an idle keep-alive socket left
  in a pool.
- **The contract tests cannot see this.** All 17 cases in
  `tests/modelProvider/modelProviderCancelConnect.test.ts` and
  `tests/coin/unit/codexCredential.service.test.ts` pass. They stub the entire `credentials`
  dependency, or stub `loadPiAuthModule` / `createBrowserCallbackCapture` / `openExternal` / the
  loopback observer. Every await that can stall in production is mocked out.

### Root cause

`ModelProviderService.cancelConnect()` has no upper bound and no instrumentation. Three of its
awaits can stall without limit, and any one of them presents exactly as the reported symptom:

1. `credentials.cancelConnect()` — aborts the controller, then awaits capture close and
   promoted-store deletion.
2. `await attempt.settled` — waits for the whole `connect()` call to unwind, including
   `performConnect`'s `finally`, whose `await browserAuthorization?.catch(...)` ends in
   `shell.openExternal(...)` and is **not** raced against the abort signal.
3. the cleanup `mutate()` — calls `credentials.getStatus()` and possibly `credentials.disconnect()`.
   Both load the Pi module and call `pi.ModelRuntime.create(...)` with **no AbortSignal and no
   deadline**. `performConnect` deliberately wraps the identical `this.getStatus()` in
   `Promise.race([this.getStatus(), waitForAbort(signal)])`; the cancel path lost that guard.

The one 60 s deadline in this subsystem belongs to Translator's translate request. Login cancel has
none, so a stall in any step above is permanent.

### Diagnostic gap

A repro today cannot distinguish those three steps. `ModelProviderService.cancelConnect()` logs
nothing at all; `credentials.cancelConnect()` logs only `cancel-requested` / `cancel-completed`
around two awaits; `performConnect`'s `finally` logs only `attempt-cleanup-completed` after three
awaits. Main-process `console` is captured to the application log (`log.setup.ts` assigns
`log.functions` onto `console`), so the missing lines are coverage, not transport.

### Required behavior

- Every step of the provider-level cancel emits a stage line, so one repro names the stalled step.
- Credential I/O on the cancel path is deadline-bounded. A timeout routes into the existing
  fail-closed cleanup, publishing `unavailable` rather than claiming `login_required`.
- Cancel always settles. The user can start a replacement Login without restarting Bitterless.

### Stalled step, named by the repro log

The instrumented run (`Bitterless_DEBUG_PROD/logs/main.log`, 2026-08-20T02:19Z) settles it. Cancel
was never the origin: the login had already **succeeded** and `performConnect` simply never
returned.

```text
02:19:35.170  attempt=1 stage=attempt-succeeded
02:19:35.171  attempt=1 stage=cleanup-capture-closing
              (no cleanup-capture-closed, no attempt-cleanup-completed —
               process kept logging for 92s until quit at 02:21:07)
```

`cleanup-capture-closing` appears once in the whole file; `cleanup-capture-closed` and
`attempt-cleanup-completed` appear zero times. `performConnect`'s `finally` is wedged on
`await capture.close()`, so `credentials.connect()` never settles, the provider never commits
`ready`, and provider-level cancel blocks on `await attempt.settled`. The earlier 01:44 run shows
the credential-level cancel itself completing in 1 ms (`cancel-requested` → `cancel-completed`),
which matches: only the provider-level wait was stuck.

Root cause and repair live in
[Codex browser login succeeds but Setting keeps waiting](codex-model-login-browser-success-stuck.md).
The deadline and instrumentation added here remain the second line of defence: cancel now settles
within `CANCEL_STAGE_TIMEOUT_MS` and publishes `unavailable` instead of spinning, whatever wedges
the attempt. No mutation-queue restructure is needed — the queue was only ever held by a connect
that could not unwind.
