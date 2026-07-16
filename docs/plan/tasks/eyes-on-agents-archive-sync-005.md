---
id: eyes-on-agents-archive-sync-005
scope: synchronize Codex thread archive and unarchive state into EyesOnAgents
status: done
depends-on: [eyes-on-agents-activation-refresh-004]
---

# EyesOnAgents Archive Synchronization

## Objective

Remove archived Codex threads from EyesOnAgents and restore unarchived threads automatically while
preserving their Domain, Project, completion, and opened/read metadata.

## Protocol evidence

- Official App Server documentation defines `thread/archived` and `thread/unarchived` notifications.
- Bundled Codex 0.144.5 schema defines both notification params as `{ threadId: string }`.
- `thread/list` defaults to non-archived rows; `archived: true` returns only archived rows.
- Codex Desktop and Bitterless own separate App Server processes, so activation Sync must reconcile
  both inventories instead of relying on cross-process notification delivery.

## Required behavior

- Add an idempotent SQLite migration for `eyes_on_agents_thread.is_archived` with integer storage.
- Exclude archived rows from repository snapshots without deleting them or changing `domain_id`.
- Active discovery upsert clears `is_archived`; archived inventory marks only explicitly returned,
  valid IDs and clears transient runtime evidence.
- Managed `thread/archived` notifications hide a known row immediately.
- Managed `thread/unarchived` notifications restore a known row immediately and trigger full Sync so
  unknown/restored rows and current metadata are imported.
- Full Sync pages both active and archived inventories with bounded limits and cancellation fencing.
- Preserve existing lifecycle evidence ordering, shutdown joining, Project resolution, Focus/unread
  derivation, and explicit disconnect behavior.
- Do not add polling, transcript reads, archive controls, or hard deletion.

## Expected paths

- `src/main/eyesOnAgents/codexAppServer.supervisor.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/preload/sqlite/dao/eyesOnAgents.*`
- `src/preload/sqlite/sqlite.preload.ts`
- `scripts/eyes-on-agents/`
- `docs/integrations/eyes-on-agents.md`
- this task and its review artifact

## Verification

- Supervisor tests prove both inventories use the correct `archived` request value and pagination.
- Repository tests prove fresh/legacy migration, hidden snapshots, preserved Domain/read metadata,
  active-upsert restore, batch archived reconciliation, and idempotence.
- Service tests prove archive notification hide, unarchive restore+sync, malformed notification
  isolation, and activation/full-sync archive reconciliation.
- `yarn test:eyes-on-agents:app-server`
- `yarn test:eyes-on-agents:repository`
- `yarn test:eyes-on-agents:core`
- `yarn typecheck:eyes-on-agents:core`
- `git diff --check`
- Process audit proves no test, App Server, or Electron helper remains after verification.

## Review

- Round 1: `docs/plan/reviews/eyes-on-agents-archive-sync-005-1.md` — accepted in the primary
  session without starting another MCP-backed review agent.
