# EyesOnAgents Active Focus and Read Semantics

Status: implemented; owner verification pending

## Symptom

A task that is still working can leave Focus after `Open` or `Read all`, then return after a later
status refresh. `Read all` also preserves the unread dot on active tasks instead of clearing every
currently visible unread marker.

## Root cause

Focus currently treats an active status as dismissible once `last_opened_at` reaches the current
status observation. `Open` therefore clears unread and suppresses the same active observation.
Separately, `Read all` excludes active runtime states in both the renderer projection and SQLite
mutation. These rules couple runtime attention to read acknowledgement even though they represent
different facts.

## Resolution contract

- Focus membership is `active runtime OR unread`. A known `working`, `waiting_approval`, or
  `waiting_input` task stays in Focus regardless of `is_unread` and `last_opened_at`.
- A successful `Open` still records `last_opened_*`. It clears `is_unread` only for a confirmed
  terminal state; active and `unknown` rows retain their latent marker so a temporary authority gap
  cannot remove a possibly running task.
- `Read all` follows the same positive terminal-state allowlist. It never changes runtime evidence
  or `last_opened_*`.
- Confirmed terminal tasks leave Focus when acknowledged. A later accepted active or terminal
  observation may set unread again.
- Runtime discovery remains evidence-based. If working evidence has not arrived yet, EyesOnAgents
  does not guess; the latent unread marker keeps `unknown` visible until Hook delivery or the
  existing ten-second refresh resolves the active state.

Delivery: [eyes-on-agents-active-focus-read-semantics-028](../plan/tasks/eyes-on-agents-active-focus-read-semantics-028.md)
