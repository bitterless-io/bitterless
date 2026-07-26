# Translator failures hide their cause and cannot reach re-login

Status: fixed

Implementation: [translator-error-diagnostics-004](../plan/tasks/translator-error-diagnostics-004.md)

## Report

A Translator request failed with `Translation failed. Edit the source to try again.` and the UI
offered no way to identify the cause or to repair a stale Codex session.

The observed copy is the `errors.provider` bucket of the running build, which covers
`provider-error`, `runtime-unavailable`, and `timeout`. Three defects combine:

1. `CodexRuntimeService` collects `providerErrorDetails` from the Pi `errorMessage` and error events,
   uses them only for auth classification, then throws `CodexRuntimeError` which carries a code and
   no detail. Every provider sentence is discarded at the throw site.
2. `TranslatorService.publicError()` returns `{ code, retryable }`, and `TranslatorError` has no
   field able to carry a cause, so the renderer receives one opaque token for unrelated failures.
3. `Main` logs nothing for a failed translation, so neither the UI nor the console can distinguish
   rate limiting, a network fault, an expired session, or a Pi load failure.

A Codex session that `classifyCodexRuntimeAuthError()` cannot recognize is the worst case: it is
reported as `provider-error` while `authState` stays `ready`, so the composer keeps its ready state,
no login affordance appears, and every retry fails the same way with the same sentence.

The first implementation exposed three follow-up ordering and recovery gaps:

1. A classified runtime auth failure broadcasts the `invalidated` provider snapshot before the
   translate response returns. The renderer cancelled and invalidated its active request on that
   snapshot, so it discarded the later `login-required · <detail>` response.
2. Invalid JSON diagnostics included a prefix of the model response. Ordinary names or business
   text are not credentials and therefore survive redaction; diagnostics must describe the output
   shape without echoing any response content.
3. Browser sign-in can wait for 180 seconds, while the Model tab has no operation that aborts Pi,
   closes the callback capture, and returns the provider to a retryable state.

## Fix contract

```text
┌─ error strip ──────────────────────────────────────────────┐
│ Translation failed.   [Try again] [Login to Codex] [Model  │
│                                                  settings] │
│ provider-error · 429 rate limit exceeded, retry after 21s   │
└────────────────────────────────────────────────────────────┘
```

### Diagnostics

- One shared `sanitizeDiagnostic()` owns the whole exposure boundary: whitespace collapse, then
  redaction, then a 240-character bound. Redaction precedes truncation so a cut cannot leak a token
  prefix.
- Redact `sk-…` keys, `Bearer …` values, JWT-shaped strings, any 24-or-more character token run,
  email addresses, and POSIX or Windows home paths.
- `CodexRuntimeError` carries a sanitized `detail`. Every throw site supplies one: Pi module load,
  auth storage and model registry construction, session creation, provider error text, stop reason,
  empty output, output ceiling, tool violation, and target mismatch.
- `TranslatorError` carries an optional sanitized `detail`. `TranslatorService` fills it for runtime
  failures, auth-required failures, timeout, invalid input, invalid output, and provider
  availability, and sanitizes again at the boundary it owns.
- Invalid-output diagnostics report only bounded structural metadata such as byte count and schema
  issue paths. They never include a prefix or excerpt of model output.
- `Main` logs `[translator] <code> <detail>` for every failed request.
- The renderer re-validates and re-bounds any received detail before rendering it. A missing,
  non-string, or empty detail renders no detail row.

### Presentation

- The error strip keeps its localized sentence and actions on the first row and adds a second row
  showing `<code> · <detail>`. The error code stays untranslated so it can be grepped against Main
  logs and this contract.
- The detail row is always visible when a detail exists, is selectable, and truncates to one line
  with an ellipsis. The full sanitized text stays available through the native title tooltip.
- The detail clears exactly when the error clears: source edit, source cleared, and a new request.

### Re-login

- `Login to Codex` appears inside the error strip for the auth family: `login-required`,
  `authenticating`, `provider-unavailable`, `load-provider`, and `login`. It reuses the existing
  store login path.
- `Open model settings` appears for every error, including `provider-error`, so an unclassified
  expired session always has a repair route. It raises or creates the Home window, routes to
  Setting, and selects the Model tab.
- A cold Home window cannot lose the request: Main holds one pending navigation for a window it had
  to create, and the Home subscriber consumes it on initialization in addition to the broadcast.
- Home stays on `/login` when customer authentication is not satisfied. The window is raised, the
  Model tab and pending Settings destination stay selected through customer login, and no route is
  forced past the guard.
- The Model tab adds `Reconnect`, a single action that disconnects then reconnects Codex, for a
  session that reports `ready` while every request fails.
- While Codex is `authenticating`, the Model tab replaces Login with `Cancel`. Cancel aborts the Pi
  login and browser callback capture in Main, waits for the active provider mutation to settle, and
  returns to `login_required` or the preceding invalidated state. A new Login can start immediately.
- Recovery needs no extra wiring in Translator: the existing `!wasReady && ready` snapshot
  transition already force-retranslates the current source.

### Ordering

- A runtime-produced `invalidated` snapshot does not invalidate the renderer request whose response
  carries the diagnostic. The active response is allowed to settle and render its error detail.
- Other ready-to-not-ready transitions still cancel active translation work.

### Cleanup

- `translator.errors.generic` is unreachable because all thirteen UI error values are mapped. Remove
  the key and the dead fallback branch in both locales.

## Acceptance

- A provider failure shows the localized sentence plus `provider-error · <cause>`, selectable and
  bounded to one line.
- Tokens, bearer values, JWTs, long token runs, emails, and home paths never reach the renderer.
- `Open model settings` raises Home from hidden, closed, and cold-start states, lands on Setting with
  the Model tab active, and works while Translator sits in an Omni cell.
- `Login to Codex` appears only for auth-family errors and reuses the existing login lifecycle.
- `Reconnect` disconnects and reconnects in one action and reports login or logout failure copy.
- `Cancel` stops a blocked browser login without waiting for timeout, closes callback capture, and
  allows the next Login attempt to succeed.
- After a successful re-login the open Translator cell retranslates the unchanged source once.
- A classified auth failure retains its concrete detail after the earlier invalidated snapshot.
- Invalid JSON never exposes model-response text in the renderer or Main log.
- Editing, clearing, and retrying clear both the error and its detail.
- `errors.generic` is absent from both locales and from the renderer mapping.
- Diagnostic sanitization unit tests, Translator tests, retry tests, the renderer i18n check, Node
  and Web type checks, and `git diff --check` pass.

## Resolution

- `src/shared/diagnostics/diagnostic.service.ts` owns the exposure boundary. It accepts a string,
  `Error`, array, or cross-process plain object, collapses whitespace, redacts keys, bearer values,
  JWTs, 24-or-more character token runs, emails, and POSIX/Windows home paths, then bounds the text
  to 240 characters. Redaction precedes truncation and the bound cannot be raised by a caller.
- `CodexRuntimeError` and `CodexRuntimeAuthRequiredError` now carry a sanitized `detail`, and every
  runtime throw site supplies a cause. `TranslatorError.detail` forwards it, `TranslatorService`
  sanitizes again at its own boundary, and every failure logs `[translator] <code> <detail>`.
- Translator renders `<code> · <detail>` as a selectable, single-line, ellipsized second strip row
  with the full text in its title, cleared together with the error. `errors.generic` and its
  unreachable branch are gone from both locales.
- `Login to Codex` shows for the five auth-family errors; `Open model settings` shows for every
  error and calls `SettingNavigationApi.openSettings({ tab: 'llm' })`. Main validates the tab, raises
  or creates Home, waits out a loading window, broadcasts `setting/open`, and holds one pending
  navigation that the Home subscriber also claims on initialization.
- Home's Setting tab moved from a component `ref` into `settingNav.store.ts`, and the Model tab
  gained guarded `Reconnect` and `Cancel` actions. Cancel is visible from local operation start,
  aborts callback capture, isolates an uncooperative late OAuth exchange in attempt-local storage,
  and lets a replacement login begin immediately without accepting stale completion state.
- Verified: Translator diagnostics/retry/language tests 21/21, Model Provider tests 13/13,
  `yarn check:renderer-i18n`, `yarn typecheck:node`, targeted ESLint, `yarn build`, and
  `git diff --check` pass. `yarn typecheck:web` retains unrelated existing Connector, Coin, Poker,
  Chat, EyesOnAgents, and shared-path diagnostics, with none in this task's touched files. Live UI
  behavior remains for Ral's manual observation as requested; no recording or screenshot was made.
- Independent review passed after all findings were resolved. See
  [translator-error-diagnostics-004-1](../plan/reviews/translator-error-diagnostics-004-1.md).
