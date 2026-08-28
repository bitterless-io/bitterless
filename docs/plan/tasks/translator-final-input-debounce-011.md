---
id: translator-final-input-debounce-011
scope: guarantee that Translator dispatches the final source revision after input settles
status: implemented; owner verification pending
depends-on: [translator-provider-error-logging-010]
---

# Translator Final Input Debounce

## Objective

Make the final complete source revision authoritative. Translator waits for one second of input
silence, submits the newest source, and never suppresses a newer revision merely because its text
matches an older submitted revision.

## Context

- [Translator](../../features/translator.md)
- [Translator final input is not dispatched](../../issues/translator-final-input-not-dispatched.md)
- `src/renderer/translator/src/store/translator.store.ts`
- `tests/translator/translatorRetry.test.mjs`

## Required Behavior

1. Replace the fixed-window leading/trailing throttle with a trailing-only 1,000 ms debounce.
2. Keep the source revision as the dispatch identity. A normal scheduled call skips only when that
   exact revision was already submitted; retry may still force-submit the current revision.
3. The scheduled callback reads `sourceText` and `revision` at execution time rather than capturing
   an input-event argument.
4. Preserve the existing active-request cancellation, request-ID fencing, late-response revision
   fencing, provider-ready recovery, empty-source reset, source bound, and retry behavior.
5. Do not change Main translation, provider/model selection, timeout, prompt, logs, UI copy, or
   login behavior.

## Expected Paths

- `src/renderer/translator/src/store/translator.store.ts`
- `docs/features/translator.md`
- `docs/issues/translator-final-input-not-dispatched.md`
- `docs/plan/tasks/translator-final-input-debounce-011.md`
- `docs/plan/reviews/translator-final-input-debounce-011-1.md`
- `docs/plan/README.md`
- `docs/INDEX.md`

## Verification

- Independent source review verifies the final-revision timeline, same-text/new-revision replay,
  empty-source guard, forced retry, provider-ready recovery, and stale-response fencing.
- Existing retry source-contract assertions follow the revision identity rather than requiring the
  removed text-based submission marker.
- `git diff --check`.
- Per owner instruction, do not run automated tests, typecheck, lint, Electron, build, packaging, or
  release commands. The owner will perform runtime verification.

## Result

Implemented.

- Translator now uses a trailing-only 1,000 ms debounce, so the dispatch callback runs after input
  settles and reads the then-current source and revision.
- Submission de-duplication records `lastSubmittedRevision`. A newer revision is submitted even when
  its text matches an older request whose response was fenced out; force retry still bypasses the
  normal same-revision guard.
- Existing active-request cancellation, provider-ready recovery, empty-source reset, request-ID
  fencing, and late-response revision fencing remain unchanged.
- The existing retry source-contract assertions now follow the revision identity. Review 1 found
  the stale text-based assertions; review 2 closed that finding and passed:
  [review 2](../reviews/translator-final-input-debounce-011-2.md).
- `git diff --check` passed. Per owner instruction, automated tests, typecheck, lint, Electron,
  build, packaging, release, and runtime translation verification were not run.
