# EyesOnAgents Working State and Focus Acknowledgement

Status: implemented; owner verification pending

## Symptoms

- A new Codex prompt can enter `working`, then the independent App Server metadata poll can replace
  that Hook evidence with an unrelated `idle` observation.
- After a manually interrupted Codex turn, Hook delivery may miss the terminal transition. The last
  `working` observation can therefore remain displayed as active in Focus.
- Submitting another prompt may briefly restore `working`, only for the next metadata poll to
  overwrite it again.

## Root cause

Bitterless owns an independent App Server process. Its `thread/read.status` describes that managed
process, not the in-memory state of Codex Desktop. It is valid for title, activity, and explicitly
authorized latest-question recovery, but it is not cross-process Desktop lifecycle evidence.

The independent App Server's process-local `thread.status` cannot repair this safely. Codex does,
however, persist each turn's own status. A bounded `thread/turns/list` request can read only the
newest turn with `itemsView: notLoaded`, providing terminal proof without loading conversation
content into Bitterless. The supervisor retains only ID, status, and completion time.

## Resolution contract

- The ten-second tiered poll never derives runtime from `thread/read.status`.
- Labelled manual `Refresh` runs the same terminal reconciliation once after full inventory sync;
  it is the explicit fallback when waiting for the next ten-second tick is undesirable.
- As a narrow exception, active Hook rows may consume metadata-only latest-turn terminal proof.
- `inProgress` never clears working. A terminal result must match the exact persisted active turn ID
  and carry a persisted completion timestamp. Missing turn identity or completion time is
  deliberately a no-op; second-precision completion time is not ordered against the millisecond
  Hook observation.
- SQLite rechecks that proof against the current row, so a late poll cannot end a newer turn.
- Terminal reconciliation retains the original active observation watermark and records the
  completed turn ID; a delayed active event for that same turn cannot revive working, while a new
  turn ID still can.
- Hook events and lifecycle notifications from the connection that owns a turn remain the only
  immediate runtime authorities; polling is eventual terminal reconciliation only.
- A successful Open records deep-link evidence for every thread but acknowledges unread only for a
  confirmed terminal row. Superseded by
  [eyes-on-agents-active-focus-read-semantics](eyes-on-agents-active-focus-read-semantics.md): the
  original rule here let Open dismiss the current active observation, which removed a still-running
  task from Focus.
- A later `UserPromptSubmit` always creates newer `working` evidence, restores unread attention, and
  keeps the thread in Focus.
- No timeout guesses that a long-running task has stopped.
- Reconciliation records the terminal state as unread. The row may remain in Focus as a newly
  finished task, but it no longer displays working.

Deliveries: [eyes-on-agents-focus-acknowledgement-024](../plan/tasks/eyes-on-agents-focus-acknowledgement-024.md),
[eyes-on-agents-stop-reconciliation-025](../plan/tasks/eyes-on-agents-stop-reconciliation-025.md)
