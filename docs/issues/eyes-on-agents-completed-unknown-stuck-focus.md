# EyesOnAgents Completed Unknown Task Stays In Focus After Open

Status: implemented; owner verification pending

## Symptom

Codex task `019f31c6-0e83-71c1-93d9-ddf10eeccf0d` (`crms-web`) had already finished,
showed no working spinner and no visible unread dot, but remained in Focus after `Open`.

Read-only production evidence captured on 2026-07-31 showed:

- the newest Codex turn `019fb724-87ed-7f53-9a83-47abd17b8450` was `completed`, with no error;
- Bitterless persisted `runtime_state = unknown`, `active_turn_id = NULL`, and `is_unread = 1`;
- the card did not expose that unread marker because the compact red dot is rendered only for
  `idle + unread`;
- Codex archived the task shortly afterwards, and Bitterless persisted the archive transition.
  Archived rows are correctly omitted from a fresh snapshot, but that later visibility transition
  does not repair the earlier `unknown + unread` acknowledgement failure.

## Root cause

A Hook listener boundary deliberately converts stale active evidence into a non-archived,
`discovery + unknown + unread` recovery candidate. The newest-turn poll currently handles only one
outcome for that candidate: `inProgress` restores `working`. A newest `completed`, `interrupted`, or
`failed` turn is discarded as a no-op even when it has a valid completion time. The row therefore
cannot become a confirmed terminal state and its latent unread marker remains in Focus indefinitely.

`Open` compounds the defect by calling `markOpened` before the one-thread status sync.
`markOpened` correctly refuses to clear unread from an `unknown` row. If the later sync were extended
to settle that row terminally, terminal persistence would set unread again after the acknowledgement,
still requiring a second click.

This is not fixed by clearing every unknown row on Open. A disconnected or malformed App Server
response may leave a genuinely active task unknown, and acknowledging that row would violate the
active Focus safety contract.

## Resolution contract

- The existing recovery candidate may consume the same bounded
  `thread/turns/list(itemsView: notLoaded, sortDirection: desc, limit: 1)` result in one of two
  mutually exclusive ways:
  - latest `inProgress` with valid identity/start time restores `working` as today;
  - latest `completed`, `interrupted`, or `failed` with valid identity/completion time settles the
    candidate to `idle`, `ended`, or `failed`.
- Terminal settlement is a dedicated refresh transition and SQLite compare-and-set. It applies only
  while the row is still non-archived, unread, `discovery + unknown`, has no active turn, and retains
  the exact selected status watermark. It records the terminal turn and completion time, clears
  active evidence, uses `app_server` as the terminal source, and keeps unread until acknowledgement.
  An equal existing `last_completed_turn_id` does not block runtime settlement; the production
  failure already had that completion marker and only its runtime projection was stale.
- A completed settlement uses the existing durable completion-alert claim, so a genuinely new
  completion can notify once while a previously claimed turn cannot notify again.
- A successful Open runs in this order: validated deep link, best-effort one-thread status sync,
  final `markOpened`, broadcast, snapshot. A newly settled terminal row is therefore acknowledged
  in the same click; a still-active or still-unknown row retains unread and remains in Focus.
- Failure, cancellation, disconnection, malformed evidence, or a compare-and-set race never fails
  the successful deep link and never broad-clears unknown attention.
- Periodic and manual Refresh share the same projection, so they can settle the stale runtime state
  to terminal while preserving unread. They do not mark the task read.
- Archive visibility remains unchanged: archived rows stay excluded from renderer snapshots, and
  archive/unarchive continues to preserve durable Domain, completion, Open, and unread history.

Delivery:
[eyes-on-agents-completed-unknown-open-034](../plan/tasks/eyes-on-agents-completed-unknown-open-034.md)
