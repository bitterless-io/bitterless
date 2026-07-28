# EyesOnAgents Completion Alert

Status: fixed

## Need

When a Codex task reaches the same newly completed state that shows the Open unread dot,
EyesOnAgents should play the supplied short tone and send one localized operating-system
notification:

```text
Thread finished
《thread name》
```

The alert must work while the EyesOnAgents window is closed because observation is owned by Main,
not by the board renderer.

## Resolution contract

- Alert only for a newly accepted `completed` turn that persists `runtime_state = idle` and
  `is_unread = 1`. Failed/interrupted turns do not currently show the unread dot and do not alert.
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

Delivery: [eyes-on-agents-completion-alert-030](../plan/tasks/eyes-on-agents-completion-alert-030.md)
