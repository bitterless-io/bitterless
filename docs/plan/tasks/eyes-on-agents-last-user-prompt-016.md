---
id: eyes-on-agents-last-user-prompt-016
scope: one bounded latest user prompt per Codex thread
status: done
depends-on: [eyes-on-agents-silent-focus-polling-018, eyes-on-agents-hook-delivery-007]
---

# EyesOnAgents Last User Prompt

Review: [eyes-on-agents-last-user-prompt-016-1](../reviews/eyes-on-agents-last-user-prompt-016-1.md)

Subsequent coverage: [eyes-on-agents-tiered-all-polling-019](eyes-on-agents-tiered-all-polling-019.md)
keeps this task's live Hook and privacy boundaries while replacing task 018's Focus-only App Server
recovery with tiered All-thread recovery.

[Task 020](eyes-on-agents-thread-ingestion-prompt-card-020.md) supersedes only this historical
task's no-ThreadCard-visual decision. It reuses the same default-off consent and bounded preview,
then adds an optional compact question echo plus the fourth Connections-guide step.

## Objective

Complete the narrow content exception defined by the feature contract: capture one bounded latest
user prompt per thread through trusted live Hooks, keep every offline Hook artifact content-free,
and commit the lifecycle transition, latest-prompt mutation, and delivery receipt atomically in
encrypted SQLite. Task 018 already delivered the default-off preference, six-column storage,
normalized snapshot, Connections disclosure, and bounded Focus-only App Server recovery; this task
must reuse those boundaries rather than add another renderer content-read API or ThreadCard visual.

## Context

- [Last user prompt contract](../../features/eyes-on-agents-last-user-prompt.md)
- [Codex observation contract](../../features/eyes-on-agents-codex-observation.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [SQLite migration release gate](../../features/sqlite-migration-release-gate.md)
- Official [Codex Hooks](https://learn.chatgpt.com/docs/hooks) and
  [App Server](https://learn.chatgpt.com/docs/app-server) contracts

## Reconciliation with task 018

- The earlier task draft proposed `getLastUserPrompt({ threadId })`. Task 018 deliberately replaced
  that broader content-read surface with parameter-free `refreshFocusedThreads()` plus the existing
  normalized snapshot, so task 016 must not add the per-thread API.
- The six SQLite columns, migration, consent marker/service, Connections switch and disclosure,
  snapshot redaction, cleanup, and bounded App Server recovery are task-018 baseline rather than
  duplicate task-016 work.
- Task 016 therefore owns only trusted Hook live capture, content-free offline projection,
  preference-epoch fencing, and atomic lifecycle/prompt/receipt persistence.

## Required behavior

- Introduce backwards-compatible V1/V2 Hook parsing. V2 carries an 8,192-byte Unicode-safe preview
  only for `UserPromptSubmit`; all other Hook content remains prohibited.
- Reuse the existing default-off **Store latest user question** preference and content-free marker.
  Helper and main-process gates must both honor it. Extend disable fencing to wait for any admitted
  Hook prompt transaction before the existing cache clear, without stopping or rejecting lifecycle
  delivery. A delivery admitted before a preference epoch change cannot persist content after a
  later re-enable.
- Strip prompt content before every offline outbox write while preserving delivery identity and
  lifecycle metadata. Content-bearing live frames must never be replayed from pending, quarantine,
  coverage, receipt, or log storage. Live commit keeps lifecycle, prompt mutation, and receipt atomic.
- Reuse task 018's six SQLite columns and normalized `EyesOnAgentsThread.lastUserPrompt` snapshot.
  The only renderer mutation remains `setLastUserPromptCaptureEnabled({ enabled })`; targeted
  recovery remains the parameter-free `refreshFocusedThreads()` operation. Do not add
  `getLastUserPrompt({ threadId })`, arbitrary App Server JSON-RPC, marker paths, or renderer prompt
  input.
- Apply monotonic source/time/turn conflict rules so offline replay and a slow App Server response
  cannot replace a newer Hook prompt. A same-turn App Server steer may refresh an App Server-owned
  preview only when its non-null result advances the checked watermark.
- Treat a newer metadata-only `UserPromptSubmit`, including V1 outbox replay, as a pending prompt:
  clear an older preview, retain the new turn/time identity, and let task 018's bounded Focus read
  recover content. Invalid prompt content degrades to this metadata-only path without suppressing
  lifecycle delivery or logging the rejected value.
- Preserve task 018's Connections disclosure and absence of prompt content in the compact
  ThreadCard.
- Preserve existing Hook trust, admission epochs, delivery dedupe, archive, Focus/unread, title,
  Domain, Refresh, and explicit disconnect behavior.

## Path

- `docs/INDEX.md`
- `docs/features/eyes-on-agents-last-user-prompt.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-last-user-prompt-016.md`
- `src/shared/eyesOnAgents/codexHookBridge.type.ts`
- `src/shared/eyesOnAgents/codexHookBridge.contract.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/codexHookBridge.helper.ts`
- `src/main/eyesOnAgents/codexHookOutbox.service.ts`
- `src/main/eyesOnAgents/lastUserPromptPreference.service.ts`
- `src/main/eyesOnAgents/codexDesktopBridge.service.ts`
- `src/main/eyesOnAgents/codexHookBridge.server.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/bridge.test.mjs`
- `scripts/eyes-on-agents/hook-delivery.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Contract tests cover V1 replay, V2 field allowlists, multiline/Unicode bounds, non-prompt event
  rejection, the metadata-only outbox conversion, and both helper/main preference gates.
- Repository tests cover fresh schema, old-schema migration, availability mapping, monotonic update,
  pending replacement, same-turn recovery, older replay, duplicate receipt, archive preservation,
  and transaction rollback.
- Core/integration tests prove trusted live capture, untrusted rejection, offline replay recovery,
  lost acknowledgement, concurrent Hook/App Server ordering, default-off upgrade, enable/disable
  fencing and cleanup, and unchanged lifecycle/unread state.
- Existing task 018 guards continue to cover the English/Chinese privacy disclosure, bounded Focus
  recovery, and the prohibition on prompt rendering in `ThreadCard`.
- Owner verification handoff remains: run `yarn typecheck:eyes-on-agents:core`,
  `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents`, and
  `yarn audit:sqlite-migrations` without launching Electron.
- A separate verify agent accepted the implementation against this task and feature contract using
  static source inspection. Per owner instruction, the implementation session ran none of the
  commands above and did not launch Electron.
