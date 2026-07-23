# EyesOnAgents Working State and Focus Acknowledgement

Status: fixed; owner verification pending

## Symptoms

- A new Codex prompt can enter `working`, then the independent App Server metadata poll can replace
  that Hook evidence with an unrelated `idle` observation.
- After a manually interrupted Codex turn, no supported Hook identifies the interruption. The last
  `working` observation can therefore remain in Focus.
- Submitting another prompt may briefly restore `working`, only for the next metadata poll to
  overwrite it again.

## Root cause

Bitterless owns an independent App Server process. Its `thread/read.status` describes that managed
process, not the in-memory state of Codex Desktop. It is valid for title, activity, and explicitly
authorized latest-question recovery, but it is not cross-process Desktop lifecycle evidence.

Codex currently has no reliable manual-interruption Hook. This delivery deliberately does not add a
`paused` state or infer interruption from private rollout files.

## Resolution contract

- The ten-second tiered poll updates metadata only and never writes runtime state.
- Hook events and lifecycle notifications from the connection that owns a turn remain the only
  runtime authorities.
- A successful Open acknowledges the currently observed active state. The thread leaves Focus until
  a newer active event arrives.
- A later `UserPromptSubmit` always creates newer `working` evidence, restores unread attention, and
  returns the thread to Focus.
- No timeout guesses that a long-running task has stopped.

Delivery: [eyes-on-agents-focus-acknowledgement-024](../plan/tasks/eyes-on-agents-focus-acknowledgement-024.md)
