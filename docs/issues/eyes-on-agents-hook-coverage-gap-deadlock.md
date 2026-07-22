# EyesOnAgents Hook coverage gap permanently blocks trusted observation

Status: fixed; owner verification pending

Implementation: [eyes-on-agents-hook-coverage-recovery-022](../plan/tasks/eyes-on-agents-hook-coverage-recovery-022.md)

## Report

EyesOnAgents shows **Status unavailable** and
`Codex hook observation failed; reconnect or Sync to retry` even though Codex Settings shows every
Bitterless Hook enabled. A Codex task can start responding without entering Focus, and Refresh does
not repair the state.

## Confirmed evidence

- A live `hooks/list` inspection returns all four exact Bitterless definitions with
  `enabled = true`, `trustStatus = trusted`, and no errors or warnings.
- The Bitterless listener socket is active.
- The development outbox contains 64 pending metadata-only deliveries, proving the Hook commands are
  running. The pending set includes session, prompt, permission, and stop events.
- The same outbox contains a durable coverage marker with reason `storage_unavailable`, four
  occurrences, and a last detection time on 2026-07-21.
- A separately spawned managed App Server returns `status.type = notLoaded` for the active Codex
  Desktop task. It can reconcile inventory and persisted metadata, but it cannot observe another
  Codex process's in-memory working state.

No original filesystem error survives in the bounded marker, so lock contention and a transient
storage failure cannot be distinguished retrospectively. The persistent recovery defect is
independent of that original cause.

## Confirmed root cause

Listener startup reports the durable coverage marker before replaying pending deliveries.
`reportCodexHookCoverageGap()` converts it into a blocking operational error and sets the in-memory
`hookCoverageGapDetected` flag. A later successful `hooks/list` briefly clears the generic error,
but bridge inspection immediately writes it back from that sticky flag.

The flag is currently cleared only by removing Codex observation. While it remains set, the bridge
cannot become `installed`, buffered and replayed deliveries fail admission, and the helper writes
more events to the same outbox. Therefore neither reconnect nor Sync can perform the recovery that
the error text promises.

Manual Refresh also awaits Hook inspection before starting inventory reconciliation and propagates
its failure. This violates the documented independence between global observation and the managed
App Server.

## Resolution

The sticky flag is now a generation paired with the exact durable gap snapshot. A trusted recheck
can acknowledge only that snapshot under the outbox lock; a newer marker deletes nothing and starts
a new generation. Recovery-operation failures retain the original marker without fabricating a
later delivery cutoff, while real emergency storage failures retain their actual detection time.

After cutover, the current trusted listener replays only the preserved suffix. Its explicit
repository authority can restore concrete Hook state over `discovery + unknown`, but not over newer
concrete App Server or Hook evidence. Connect, Refresh, and auto-connect continue inventory
reconciliation even when observation recovery remains unavailable. The displayed retry instruction
now names **Check status** and **Refresh**.

## Required correction

1. Treat a coverage marker as a recoverable stream discontinuity, not permanent Hook trust failure.
2. Before recovery, fence the current admission lifetime and invalidate active `codex_hook`
   evidence so no state from the incomplete prefix remains current.
3. Under the outbox lock, use the marker's latest detection time as a cutover: discard only pending
   deliveries at or before the cutover, preserve later valid deliveries, then acknowledge the
   marker. Never remove the complete outbox or the preserved suffix.
4. Require a fresh successful inspection of the exact enabled and trusted Hook definitions before
   reopening admission. After the lifetime is trusted, replay the preserved suffix oldest-first and
   retain the existing receipt-based dedupe and commit-before-ACK rules.
5. If cutover, inspection, replay, or SQLite commit fails, keep the marker/pending data and truthful
   error state. A new coverage marker after recovery must start a new recovery generation rather
   than being cleared by an older attempt.
6. Listener-start invalidation is the lifetime fence. A delivery committed by the current listener
   may restore active state even when its provider occurrence time predates `listeningSince`; this
   is required for durable offline replay.
7. Refresh and Connect must continue managed App Server inventory work when observation startup or
   inspection fails. App Server `notLoaded` remains `unknown`; only a trusted Hook lifecycle event
   may supply the missing Codex Desktop working state.

## Acceptance

- With the confirmed marker and pending suffix, one Check status or Refresh returns observation to
  installed/listening without Disable and without deleting the valid suffix.
- Pending post-cutover events commit once and are removed from the outbox. A final prompt without a
  stop produces `working`, unread, and Focus; a final stop produces idle unread attention.
- Pre-cutover events cannot restore stale active state.
- Recovery failure preserves the marker and pending suffix; retry remains possible.
- A newly reported gap cannot be accidentally cleared by an older in-flight recovery.
- A Hook inspection/listener failure does not prevent active and archived inventory reconciliation.
- Managed App Server `notLoaded` does not fabricate Focus, while a later trusted Hook start does.
- No Electron process is launched by automated verification.
