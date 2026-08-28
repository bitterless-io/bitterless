# Translator Final Input Is Not Dispatched

Status: Implemented; owner verification pending

Implementation:
[translator-final-input-debounce-011](../plan/tasks/translator-final-input-debounce-011.md)

## Symptom

After the source text is edited, Translator can keep showing a result that does not correspond to
the final text. Stopping input does not always produce another translation request.

## Root Cause

The configured VueUse throttle does have both leading and trailing execution. The failure is the
combination of two renderer rules that use different identities:

1. stale responses are fenced by the monotonically increasing source revision;
2. duplicate submissions are suppressed only by comparing source text.

If revision `r1` submits `A`, the user edits to `B`, and then corrects the final text back to `A`,
the `r1` response is correctly ignored because the revision changed. The final scheduled call is
then incorrectly skipped because its text still equals `lastSubmittedSource`. There is no accepted
result for the final revision, so the trailing call has run without dispatching the final input.

The leading/trailing throttle also runs at fixed windows measured from the leading call. That is not
the desired Translator interaction: translation should start after the user has stopped editing,
with the newest complete source revision.

## Required Behavior

- Every real non-empty source edit re-arms one 1-second trailing debounce.
- The callback reads the current source and revision when it runs.
- Only a submission of the same source revision is a duplicate. Editing away and back to identical
  text creates a newer revision and must dispatch again.
- Existing request cancellation, request-ID fencing, and revision fencing remain in place so an
  older response cannot overwrite the final result.
- Clearing the source cancels active work and must not allow a pending debounce to submit empty or
  stale text.

## Acceptance

- Continuous typing followed by a pause dispatches the final complete text once.
- Editing `A` to another value and back to final `A` dispatches the final revision.
- A source change while cancellation is settling is still picked up by a later trailing callback.
- Empty input never dispatches a translation.
- Independent source review and `git diff --check` pass. Per owner instruction, automated tests,
  typecheck, Electron, build, packaging, and release remain assigned to the owner.
