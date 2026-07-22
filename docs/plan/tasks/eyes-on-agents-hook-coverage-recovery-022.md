---
id: eyes-on-agents-hook-coverage-recovery-022
scope: recover durable Codex Hook coverage gaps and preserve App Server independence
status: implemented; owner verification pending
depends-on: [eyes-on-agents-hook-delivery-007, eyes-on-agents-global-onboarding-008]
---

# EyesOnAgents Hook Coverage Recovery

## Objective

Recover a trusted Codex observation installation from a durable outbox coverage gap without asking
the user to remove observation, without losing the valid post-gap suffix, and without allowing Hook
health to block managed App Server inventory synchronization.

## Context

- [Hook coverage deadlock issue](../../issues/eyes-on-agents-hook-coverage-gap-deadlock.md)
- [Codex observation contract](../../features/eyes-on-agents-codex-observation.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [Reliable Hook delivery](eyes-on-agents-hook-delivery-007.md)
- [Global observation onboarding](eyes-on-agents-global-onboarding-008.md)

## Required behavior

- Stop automatic outbox replay at a coverage marker. Report the discontinuity and preserve pending
  files until Main explicitly completes the recovery fence.
- Add an outbox-lock-protected recovery operation that consumes emergency state, computes the latest
  gap cutoff, removes only pending deliveries whose occurrence time is at or before that cutoff,
  and removes the acknowledged marker last. A crash before marker removal must remain retryable.
- After a fresh trusted `hooks/list`, recover the marker, clear only the matching in-memory gap
  generation, establish a trusted listener lifetime, then explicitly drain the preserved suffix
  oldest-first. Receipt dedupe and commit-before-ACK remain unchanged.
- A concurrent/new gap must win over an older recovery attempt. Failure must retain a blocking
  operational status and never silently discard the preserved suffix.
- On every listener start, invalidate active Hook evidence before accepting delivery. Use that
  successful invalidation—not provider occurrence time relative to listener start—as the lifetime
  fence so current-listener replay can restore working state.
- Manual Refresh, Connect, and auto-connect initialization attempt observation recovery but continue
  App Server active/archived inventory reconciliation if observation fails. They never claim that a
  separately spawned App Server can see Codex Desktop's private in-memory runtime.

## Expected paths

- `docs/INDEX.md`
- `docs/issues/eyes-on-agents-hook-coverage-gap-deadlock.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/plan/README.md`
- `src/main/eyesOnAgents/codexHookOutbox.service.ts`
- `src/main/eyesOnAgents/codexHookBridge.server.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/eyesOnAgents/codexDesktopBridge.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/hook-delivery.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`

## Verification

- Outbox tests cover cutover prefix removal, suffix preservation, marker-last retry semantics, no-gap
  idempotence, replay pause, and recovery replay.
- Service tests cover trusted recovery, generation races, replay-to-working Focus/unread, recovery
  failure preservation, and App Server inventory continuing after observation failure.
- Existing repository receipt/dedupe and App Server `notLoaded` normalization remain covered.
- Run only targeted Node tests and strict EyesOnAgents Core typecheck. Do not launch Electron; Ral
  performs the live UI confirmation.

## Result

Implemented locked, exact-marker recovery with retry-safe emergency handling, current-listener
repository authority for preserved replay, and observation-independent inventory synchronization.
The recovery error now directs the user to **Check status** or **Refresh** instead of the obsolete
reconnect/Sync wording. Independent review accepted the implementation; Ral retains the live
Electron confirmation.

Review: [eyes-on-agents-hook-coverage-recovery-022-1](../reviews/eyes-on-agents-hook-coverage-recovery-022-1.md)
