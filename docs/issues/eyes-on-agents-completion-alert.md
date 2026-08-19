# EyesOnAgents Completion Alert

Status: implemented; Claude audible verification pending

## Need

When a Codex task reaches the same newly completed state that shows the Open unread dot, or when an
accepted Claude `Stop` says the main agent has finished one response, EyesOnAgents should play the
supplied short tone and send one localized operating-system notification:

```text
Thread finished
《thread name》
```

The alert must work while the EyesOnAgents window is closed because observation is owned by Main,
not by the board renderer.

## Resolution contract

- Alert only for a newly accepted `completed` turn that persists `runtime_state = idle` and
  `is_unread = 1`. Failed/interrupted turns do not currently show the unread dot and do not alert.
- A valid Claude `Stop` uses its already-validated Hook delivery UUID as the concrete completion
  identity. It may therefore alert without a preceding `UserPromptSubmit` or persisted active turn.
  This means “Claude finished this response; return to review it,” not “the broader task goal is
  complete.” If another Stop hook makes Claude continue, each later distinct accepted `Stop` is a
  separate response boundary and may alert once.
- Claude `StopFailure`, user interruption, rejected installation generations, disabled-provider
  events, events at or before the enable cutoff, stale events superseded by newer runtime evidence,
  archived rows, and duplicate delivery UUIDs do not alert.
- Claim `(thread_id, turn_id)` in a SQLite receipt table in the same transaction as the accepted
  terminal transition. Hook delivery, App Server notification, and metadata-only terminal
  reconciliation may race, but the same thread/turn emits at most one alert across restarts.
- Do not alert when loading an existing snapshot, importing historical tasks, reconnecting without
  a new terminal transition, or receiving a duplicate completion delivery. The migration seeds
  receipts for existing completed turns.
- Commit SQLite state before the side effect. Sound/notification failure must never roll back or
  duplicate the completion state.
- Show a Main-process system notification through the shared notification-center helper using the
  current application language. The body contains only the bounded thread title (or localized
  untitled fallback), never prompt or response content.
- Play `mixkit-digital-quick-tone-2866.wav` from a packaged external resource. macOS uses the
  built-in `afplay`; Windows uses the built-in `System.Media.SoundPlayer`. The notification itself
  is silent so the supplied tone is not doubled by the OS default sound.

Delivery: [eyes-on-agents-completion-alert-030](../plan/tasks/eyes-on-agents-completion-alert-030.md),
[eyes-on-agents-claude-stop-alert-047](../plan/tasks/eyes-on-agents-claude-stop-alert-047.md)
