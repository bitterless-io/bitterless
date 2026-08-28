---
id: translator-final-input-debounce-011-1
status: fail
reviewed_task: translator-final-input-debounce-011
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-source-and-contract
---

# Verdict

**FAIL. The final-input runtime path is correct, but one P2 repository-test regression must be
resolved before handoff.**

# Findings

- P1 blocking: none.

## P2 blocking — the committed retry contract test still requires the removed text identity

The store deliberately replaces `lastSubmittedSource` with `lastSubmittedRevision`, but the
existing Translator retry source-contract test still requires assignments to
`lastSubmittedSource` in both request submission and blank-source reset
(`tests/translator/translatorRetry.test.mjs:51-54`, `:94-97`). Those regular expressions cannot
match the current store, which assigns `lastSubmittedRevision` instead
(`src/renderer/translator/src/store/translator.store.ts:129`, `:175`). The owner's next test run
will therefore fail even though the new runtime behavior is correct.

Update those existing assertions to verify the revision identity. The submission assertion should
require `this.lastSubmittedRevision = sourceRevision`; the blank-source assertion should require
`this.lastSubmittedRevision = null`. No runtime test execution is needed to make this mechanical
contract update.

- P3 non-blocking: none.

# Contract Assessment

- `setSourceText()` ignores only a value that is unchanged after bounding. Every real source edit
  writes the newest text, increments the monotonically increasing revision, clears stale direction
  and error state, and schedules when the provider is ready
  (`src/renderer/translator/src/store/translator.store.ts:118-135`).
- The configured `useDebounceFn` has one 1,000 ms trailing callback and no leading submission. It
  receives no input-event snapshot; when the timer fires it calls `translateLatest()`, which reads
  the store's then-current `sourceText` and `revision`
  (`src/renderer/translator/src/store/translator.store.ts:156-160`, `:269-273`). Continuous input
  therefore re-arms the same debounce and the last settled value is authoritative.
- Duplicate suppression compares the exact captured revision with `lastSubmittedRevision`, not
  source text. An `A r1 -> B r2 -> A r3` sequence submits `r3` because `r3 !== r1`, while a second
  normal call for the already submitted `r3` is skipped
  (`src/renderer/translator/src/store/translator.store.ts:156-160`, `:173-176`).
- Retry preserves its existing eligibility guards and calls `translateLatest({ force: true })`, so
  it bypasses same-revision suppression without weakening normal scheduled de-duplication
  (`src/renderer/translator/src/store/translator.store.ts:84-91`, `:205-208`).
- An empty value clears the visible translation and revision submission identity and starts active
  cancellation. A still-pending debounce can execute, but the current-source empty guard returns
  before dispatch, so it cannot send its earlier value
  (`src/renderer/translator/src/store/translator.store.ts:127-135`, `:156-160`).
- If provider readiness is lost, active work is canceled. When readiness returns with non-empty
  source, the current revision is force-submitted immediately; a later pending debounce observes
  that same submitted revision and becomes a no-op
  (`src/renderer/translator/src/store/translator.store.ts:236-250`).
- During replacement, `translateLatest()` snapshots source and revision, awaits cancellation of the
  prior request, and rechecks both values before dispatch. An edit while cancellation is settling
  causes that stale invocation to return, while the edit independently re-arms the debounce for a
  later invocation of the newest revision (`src/renderer/translator/src/store/translator.store.ts:156-171`).
- Request-ID and revision fencing remain unchanged around completed results, errors, and `finally`.
  A canceled or late request cannot overwrite the final revision or clear a newer request's active
  state (`src/renderer/translator/src/store/translator.store.ts:173-202`).

# Verification

- `git diff --check` — pass.
- Current task diff, complete Translator store, input binding, and existing Translator retry
  source-contract test — inspected.
- Automated tests, typecheck, and lint — not run per owner instruction.
- Electron, build, packaging, release, and manual runtime translation — not run per owner
  instruction.

# Conclusion

The implementation fixes the reported final-input loss and preserves cancellation/fencing
semantics. Handoff remains blocked only because the existing retry contract test still asserts the
removed text-based submission identity; update its two assertions, then re-review.
