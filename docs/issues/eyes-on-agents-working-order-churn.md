# EyesOnAgents Working Cards Reorder During Replies

Status: implemented; owner verification pending

## Symptom

Several working tasks repeatedly change position while Codex replies. A card can move between mouse
down and click handling, making an intended Open action land on a different task.

## Root cause

The renderer uses one shared comparator for Focus, All, custom Domains, and global-search results.
It first ranks attention states, then sorts every task in the same rank by
`lastActivityAt ?? lastCompletedAt` descending.

The ten-second metadata refresh intentionally advances `lastActivityAt` when Codex reports newer
thread activity. Reply progress therefore changes the ordering key even though the task did not
enter a new working state. The comparator also has no explicit immutable tie-breaker, so equal
timestamps inherit SQLite input order, which is itself activity-based.

## Resolution contract

- Use these attention ranks: `waiting_approval`, `waiting_input`, visible unread dot, `working`, then
  ordinary tasks. The visible-dot rank means unread `idle`, `failed`, `ended`, or `unknown`; a
  working row's latent unread bit remains in the working rank.
- Within one active rank, sort by persisted `statusObservedAt` descending. For an active task this
  is the time it entered its current working/waiting state; title, question, reply, and
  `lastActivityAt` refreshes do not change it.
- A genuine runtime-state transition may update `statusObservedAt` and therefore may reposition the
  card. Starting a newer working state should place it ahead of older working tasks.
- If the active timestamp is absent or invalid, use zero rather than falling back to
  `lastActivityAt`; this preserves stability under metadata refresh.
- Non-active ranks continue to sort by `lastActivityAt ?? lastCompletedAt` descending.
- Finish every equal-rank/equal-time comparison with `threadId` ascending so input order cannot
  cause movement.
- Apply the same comparator to every rendered thread list. Since task 054 that is the single Focus
  column, which lists every visible thread; expanding its membership did not change this comparator.
  Do not change the SQLite hot/cold refresh-page ordering, which is a data-fetch allocation policy
  rather than UI presentation order.

Delivery:
[eyes-on-agents-working-start-order-035](../plan/tasks/eyes-on-agents-working-start-order-035.md),
with the tier precedence updated by
[eyes-on-agents-unread-before-working-order-068](../plan/tasks/eyes-on-agents-unread-before-working-order-068.md).
