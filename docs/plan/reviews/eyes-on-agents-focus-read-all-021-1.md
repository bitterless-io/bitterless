# EyesOnAgents Focus Read All Review 1

Status: accepted

Date: 2026-07-22

Task: [eyes-on-agents-focus-read-all-021](../tasks/eyes-on-agents-focus-read-all-021.md)

## Finding resolved during review

- **P2:** The first repository implementation updated `updated_at` together with `is_unread`.
  Because EyesOnAgents uses `updated_at` as an activity-order fallback, acknowledging an old thread
  could move it forward in All and hot-page polling. The final SQL changes only `is_unread`; the
  repository regression assertion now proves `updated_at`, `last_opened_turn_id`, and
  `last_opened_at` remain unchanged.

## Accepted evidence

- The action is a persistent, compact, labelled mini text button rendered only at the right of the
  Focus header. It is disabled without eligible unread attention or while another foreground action
  is active, uses the existing loading state, has visible keyboard focus, and adds no border, card,
  divider, icon, count, or shadow.
- Renderer, Main, and SQLite expose one parameter-free `markAllRead()` path. Main broadcasts only
  when persistence reports a real change and always returns a current snapshot to the caller.
- One bounded SQLite UPDATE clears only non-archived unread rows outside `working`,
  `waiting_approval`, and `waiting_input`. Active latent markers and archived markers remain intact;
  when no eligible row exists, it produces no write or broadcast.
- The operation never calls the Codex deep link or `markOpened`, and it leaves both `last_opened_*`
  fields and ordering timestamps unchanged. New lifecycle evidence may set a cleared row unread
  again.
- Applying the shared snapshot removes the same idle unread dot from Focus, All, and custom Domain
  projections; idle rows focused only by unread leave Focus, while active rows remain through their
  independent runtime state.
- English and Chinese labels, persistence bounds, no-op behavior, Open-marker preservation, active
  and archived protection, conditional broadcast, and compact styling have targeted regression
  coverage.

## Verification boundary

The independent review used source and diff inspection only and found no remaining P1, P2, or P3
issue after the fix. The repository test suite passes and the renderer-specific typecheck passes.
No Electron process was launched; Ral retains visual/runtime acceptance.
