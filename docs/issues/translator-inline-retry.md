# Translator failure requires editing before retry

Status: fixed

Implementation: [translator-inline-retry-003](../plan/tasks/translator-inline-retry-003.md)

## Report

The retryable Translator error copy currently says `Translation failed. Edit the source to try
again.` The renderer suppresses an identical source submission, so the user must make an artificial
edit even when the original input is valid and the failure is transient.

## Fix contract

```text
┌─ retryable error strip ───────────────────────┐
│ Translation failed.  [Try again]              │
└───────────────────────────────────────────────┘
```

- Put a localized `Try again` text button directly after the retryable error message.
- Clicking or keyboard-activating the button force-submits the current unchanged, non-empty source.
- Reuse the existing request lifecycle, cancellation, revision fence, provider check, and
  `translateLatest({ force: true })` duplicate-suppression bypass.
- Prevent a second activation while retrying. Clear the old error as the normal Translating state
  takes over, and preserve the last valid translation while retrying.
- Never show or execute retry for an empty or whitespace-only source. Clearing the source clears the
  error and previous translation, cancels active work, and restores the empty state.
- Show the inline action for errors that can plausibly succeed without editing: `provider-error`,
  `runtime-unavailable`, `timeout`, `invalid-output`, and `output-too-large`.
- Do not show it for invalid input, auth/login/provider availability, target mismatch, tool
  violation, local provider-load failure, or login-action failure.
- Keep copy localized in both English and Chinese. The button must remain an actual accessible
  control, not a click handler on plain text.

## Acceptance

- The English failure row reads `Translation failed. Try again`, with only `Try again` interactive.
- The Chinese failure row presents the equivalent localized message and action.
- Activating the action retries the unchanged source immediately and only once.
- The action is absent for non-retryable/auth errors and cannot start a concurrent retry.
- Empty and whitespace-only source cannot retry; clearing after a failure removes the error and old
  result without issuing another translation request.
- Existing edit-triggered, stale-response, cancellation, and login behavior remains unchanged.
- Focused source/interaction tests, renderer i18n check, touched type checks, and `git diff --check`
  pass.

## Resolution

- Retryable failures now render a localized Arco mini text button directly after the error sentence.
  The Royal Blue action is keyboard accessible and uses the existing visible-focus treatment.
- The Store exposes retry only for the five documented transient/output errors and force-submits the
  unchanged source through the existing request lifecycle. Ready, source, busy, and error guards
  prevent invalid or concurrent requests.
- Empty and whitespace-only sources cannot retry. Clearing the composer clears the error, previous
  result, and duplicate marker, then cancels active work without scheduling another translation.
- Independent review found no P1, P2, or P3 finding. Retry tests pass 5/5, existing Translator tests
  pass 7/7, renderer i18n and Node type checking pass, and the full Web check reports only unrelated
  baseline diagnostics. See
  [translator-inline-retry-003 round 1](../plan/reviews/translator-inline-retry-003-1.md).
