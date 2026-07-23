# EyesOnAgents Working State and Focus Acknowledgement

Status: fix in progress

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
content.

## Resolution contract

- The ten-second tiered poll never derives runtime from `thread/read.status`.
- As a narrow exception, active Hook rows may consume metadata-only latest-turn terminal proof.
- `inProgress` never clears working. A terminal result must match the persisted active turn ID, or
  when the Hook supplied no usable turn ID, have a completion timestamp at least as new as the
  persisted working observation.
- SQLite rechecks that proof against the current row, so a late poll cannot end a newer turn.
- Hook events and lifecycle notifications from the connection that owns a turn remain the only
  immediate runtime authorities; polling is eventual terminal reconciliation only.
- A successful Open acknowledges the currently observed active state. The thread leaves Focus until
  a newer active event arrives.
- A later `UserPromptSubmit` always creates newer `working` evidence, restores unread attention, and
  returns the thread to Focus.
- No timeout guesses that a long-running task has stopped.
- Reconciliation records the terminal state as unread. The row may remain in Focus as a newly
  finished task, but it no longer displays working.

Deliveries: [eyes-on-agents-focus-acknowledgement-024](../plan/tasks/eyes-on-agents-focus-acknowledgement-024.md),
[eyes-on-agents-stop-reconciliation-025](../plan/tasks/eyes-on-agents-stop-reconciliation-025.md)
