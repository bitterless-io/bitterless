# EyesOnAgents Missed Working Recovery

Status: implemented; owner verification pending

## Symptom

A Codex task is visibly working and remains in the EyesOnAgents Focus column, but its card has no
working spinner. Waiting for the ten-second poll or selecting the labelled `Refresh` action does not
repair the card.

## Confirmed cause

Focus membership and runtime state are intentionally separate. An unread row remains in Focus even
when its runtime state is `unknown`; the spinner renders only for `working`.

When a Hook listener lifetime ends or restarts, Bitterless invalidates its old Hook-owned active
evidence to `discovery + unknown` while preserving unread attention. This prevents stale working
from surviving a listener gap. However, Codex does not replay a `UserPromptSubmit` event for a turn
that was already running before the new listener lifetime, and a previously committed Hook delivery
may already have been removed from the outbox.

The independent App Server's `thread/list` / `thread/read.status` reports process-local
`notLoaded`, so the existing Refresh correctly refuses to infer Desktop runtime from it. The
metadata-only latest-turn query is currently issued only for a row that is already active and
Hook-owned. Once invalidation clears that active identity, neither polling nor manual Refresh asks
for the latest persisted turn, leaving the valid combination `unknown + unread` indefinitely.

## Resolution contract

- Keep listener-start invalidation and keep `thread/read.status` outside the Desktop runtime
  authority boundary.
- Treat only a non-archived `discovery + unknown + unread` row with no active turn and a concrete
  observation watermark as a missed-working recovery candidate.
- For that candidate, reuse the content-free newest-turn request:
  `thread/turns/list(itemsView: notLoaded, sortDirection: desc, limit: 1)`. Main may retain only
  turn ID, status, start time, and completion time from the response.
- A valid latest `inProgress` turn with a real ID and non-future persisted start time may recover
  `working`. SQLite must compare-and-set against the exact candidate state, unread bit, source,
  active-turn absence, and observation watermark, and must reject a turn already recorded as
  completed. A concurrent Open, newer Hook event, archive, or other status change makes the patch a
  no-op.
- Record recovered evidence with a distinct `app_server_turn` source, not the process-local
  `app_server` source. Inventory `notLoaded` observations and App Server reconnect invalidation must
  not erase this persisted turn identity. Keep the task unread and use the persisted start time for
  activity/status ordering.
- Active rows recovered from latest-turn metadata participate in the existing exact-ID terminal
  reconciliation, so a later `completed`, `interrupted`, or `failed` turn cannot leave the recovered
  spinner stuck.
- Empty, malformed, unavailable, terminal, missing-ID, missing-start-time, or future-time evidence
  does not recover working. No elapsed-time guess, private transcript scan, response content, or
  paused state is introduced.
- The ten-second hot/cold poll and labelled manual Refresh continue to share the same reconciliation
  path.

Delivery: [eyes-on-agents-working-recovery-027](../plan/tasks/eyes-on-agents-working-recovery-027.md)
