---
id: eyes-on-agents-working-recovery-027
scope: recover missed Desktop working state from metadata-only latest-turn proof
status: implemented; owner verification pending
depends-on: [eyes-on-agents-stop-reconciliation-025, eyes-on-agents-hook-coverage-recovery-022]
---

# EyesOnAgents Working Recovery

## Objective

Repair a task that remains unread in Focus but lost its working state at a Hook listener lifetime
boundary, without trusting the independent App Server's process-local thread status or reading any
conversation content.

## Required behavior

- Select a recovery candidate only when SQLite still contains a non-archived, unread,
  `discovery + unknown` row with no active turn and a concrete status observation watermark.
- Reuse one descending `thread/turns/list(itemsView: notLoaded, limit: 1)` request for either a
  recovery candidate or an already-active terminal-reconciliation candidate. The supervisor
  projects only ID, status, `startedAt`, and `completedAt`, and rejects non-empty turn items.
- Accept `inProgress` for recovery only with a real turn ID and a valid persisted start time no
  later than the poll. Do not use `thread/list.status`, `thread/read.status`, timestamps invented by
  Bitterless, transcript/rollout files, or elapsed-time guesses.
- Add an explicit working-recovery refresh patch. Validate it at the shared XPC/repository boundary.
- Apply the patch atomically only if the row is still the exact selected
  `discovery + unknown + unread` candidate, remains unarchived, has no active turn, retains the same
  status watermark, and has not already completed the same turn. Set `working`, the real active turn
  ID, distinct `app_server_turn` source, provider start/activity time, and keep unread.
- Keep `app_server_turn` separate from process-local `app_server` lifecycle evidence. Full inventory
  `notLoaded` discovery and App Server reconnect invalidation must preserve recovered active identity
  and reconciled terminal state so manual Refresh's sync-before-detail order remains safe.
- Let real Hook evidence supersede recovered App Server evidence normally. A concurrent Open,
  archive, newer status, or replacement turn must make delayed recovery a no-op.
- Extend exact-ID terminal reconciliation to an active row recovered from App Server turn metadata,
  with source plus observation watermark included in the compare-and-set guard.
- Preserve hot-first/cold-round-robin paging, one request per selected task, cancellation fencing,
  silent polling, field-level writes, and the labelled manual Refresh path.
- Keep the existing Stop contract for terminal turns without `completedAt` unchanged; that is a
  separate provider-shape issue.

## Expected paths

- `docs/issues/eyes-on-agents-working-recovery-gap.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/codexAppServer.supervisor.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/app-server.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- A selected `unknown + discovery + unread` row plus valid latest `inProgress` metadata becomes
  `app_server_turn`-sourced working with the exact real turn ID and remains unread in Focus.
- Missing/malformed/future start times, terminal latest turns, already-read or archived rows,
  completed same-turn identity, a changed watermark, a newer Hook event, and a replacement active
  turn do not recover working.
- A later exact-ID terminal turn ends a recovered App Server working row through the existing
  mapping; a mismatched or late result cannot end another turn.
- A full `notLoaded` inventory upsert before detail reconciliation preserves `app_server_turn`
  active identity and terminal state.
- The metadata request remains `notLoaded`, descending, limit one, and contains no turn items.
- Polling and manual Refresh share the repair path, with no Electron run and no package/release.

## Delivery evidence

- `yarn test:eyes-on-agents` passes, including Core, repository, App Server, bridge/delivery,
  Project-filter, and UI/source contracts.
- `yarn typecheck:node` and `git diff --check` pass.
- The stricter scoped check still reports only the two pre-existing `rawInput: unknown` errors in
  unchanged `src/shared/eyesOnAgents/codexHookBridge.contract.ts`; task 027 adds no scoped type error.
- [Independent Round 2 review](../reviews/eyes-on-agents-working-recovery-027-1.md) accepted the final
  implementation with no open P1, P2, or P3 finding.
- Electron was not started and no package, release, or commit was produced; Ral owns runtime
  verification.
