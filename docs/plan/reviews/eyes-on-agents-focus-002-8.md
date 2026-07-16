# Review: eyes-on-agents-focus-002 (round 8 checkpoint)

## Verdict

**blocking** — round 7's immutable failure epoch closes the rejected-write revival race, but the
pre-round-9 inspection transition can lose an ordinary trusted terminal event. A concurrent Sync
captures the current FIFO tail while the lifetime still admits live events; a later `Stop` joins
behind that captured tail and is then skipped by the inspection epoch change.

## Blocking finding

### [P1] Sync's single-capture drain can discard a trusted `Stop` received behind a slow write

The checkpoint implementation waits for the current `hookWriteTail` before changing the listener
lifetime from `trusted` to `pending`. That wait captures only the promise that was current at the
time Sync began. Hook intake remains trusted during the wait, so a later hook can still append a
new closure behind the captured promise.

A deterministic failure trace is:

1. Trusted event P starts a slow, successful repository write.
2. Sync captures P as its drain target and waits, while the listener lifetime remains `trusted`.
3. Terminal event Q (`Stop`) arrives and is appended behind P with P's admission epoch.
4. P settles. Sync's captured wait completes even though Q is now the FIFO tail; Sync advances the
   admission epoch and begins `hooks/list`.
5. Q receives its turn, observes the epoch mismatch, and exits without persisting completion.

This is a Focus-correctness failure, not merely delayed refresh: the accepted `UserPromptSubmit`
can leave the thread `working`, while the matching terminal transition is permanently absent. The
round 7 failure/retry regressions cover rejected tails, but not a normal successful slow write plus
a concurrent Sync and terminal arrival.

Required correction before acceptance:

- Establish the fresh `pending` admission boundary before capturing or awaiting the old FIFO tail.
- Buffer events received after that boundary, with the existing bounded-queue semantics.
- Drain all work admitted by the preceding epoch before advancing to `hooks/list`.
- After a trusted inspection, flush the buffered suffix in arrival order; a non-installed result
  must discard it.
- Add a deterministic successful slow-write regression proving P persists, Q waits while the old
  tail is blocked, and Q persists after the fresh trusted inspection.

## Checkpoint verification

The focused suite and scoped type checks passed at the checkpoint, but no checked-in regression
exercised the trace above. The green result therefore did not establish terminal-event preservation
across the normal trusted-write/Sync boundary.

## Conclusion

**blocked** — repository failures now poison their immutable admission epoch, but a successful
trusted write can still race a single-capture Sync drain and lose the following terminal event.
Round 9 must verify that `pending` is established before the old tail is drained and that the new
slow-write regression closes the trace end to end.
