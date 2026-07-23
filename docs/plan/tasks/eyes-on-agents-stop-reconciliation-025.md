---
id: eyes-on-agents-stop-reconciliation-025
scope: reconcile stale Hook working state from a metadata-only terminal-turn poll
status: in-progress
depends-on: [eyes-on-agents-focus-acknowledgement-024, eyes-on-agents-tiered-all-polling-019]
---

# EyesOnAgents Stop Reconciliation

## Objective

Let the existing ten-second hot/cold polling cycle eventually replace a stale Hook `working` state
after Codex manually stops a turn. Preserve Hook authority while a turn is still running, keep the
completion unread, and do not add or infer a paused state.

## Required behavior

- `thread/read.status` remains process-local metadata and must never overwrite Codex Desktop Hook
  runtime evidence.
- Only rows that are currently active and Hook-owned are eligible for terminal reconciliation.
- For an eligible row, request at most the newest turn through `thread/turns/list` with
  `itemsView: notLoaded`, descending order, and limit one. This status check must not load turn
  items, messages, reasoning, tool calls, replies, or attachments.
- `inProgress`, an empty page, a malformed response, or a failed request changes no runtime state.
- `completed`, `interrupted`, or `failed` is accepted only when it proves the current persisted
  active turn: require the same turn ID when one is known; otherwise require a terminal timestamp
  no older than the Hook working observation.
- Apply terminal evidence atomically against the current SQLite row. A newer/replaced active turn,
  non-Hook source, archived row, or already-terminal row makes the patch a no-op.
- Reconciled `completed` becomes `idle`, `interrupted` becomes `ended`, and `failed` becomes
  `failed`. Clear active flags/turn, record completion, and keep/set unread so the just-finished task
  remains in Focus until Open or `Read all` acknowledges it.
- Reuse the existing hot-first plus round-robin cold paging, concurrency cap, cancellation fence,
  silent refresh, and write-only-when-changed behavior.
- No TTL, private rollout/transcript scan, or `paused` state.

## Expected paths

- `docs/issues/eyes-on-agents-working-focus-stale.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/plan/analysis/eyes-on-agents.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/codexAppServer.supervisor.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- A Hook working row plus matching newest `interrupted` turn becomes ended and unread.
- Matching newest `completed` and `failed` turns map to idle and failed respectively.
- `inProgress`, stale timestamps, mismatched turn IDs, replaced active rows, non-Hook sources, and
  malformed/failed pages do not change runtime state.
- The status request is `itemsView: notLoaded`, descending, limit one and is issued only for active
  Hook candidates selected by the existing hot/cold page cycle.
- A later Hook `UserPromptSubmit` remains authoritative and restores working normally.
- No Electron UI run and no package/release; Ral owns runtime verification.

