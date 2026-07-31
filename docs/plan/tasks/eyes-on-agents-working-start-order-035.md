---
id: eyes-on-agents-working-start-order-035
scope: stable active-task presentation order by current working-state start time
status: implemented; owner verification pending
depends-on: [eyes-on-agents-completed-unknown-open-034]
---

# EyesOnAgents Working Start Order

## Objective

Keep active tasks at the top while preventing reply-message activity from moving cards underneath
the pointer. Within each existing active attention rank, the most recently entered working state
appears first and remains stable until a real runtime transition occurs.

## Context

- [Working order churn issue](../../issues/eyes-on-agents-working-order-churn.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)

## Required behavior

- Preserve `waiting_approval > waiting_input > working > unread > ordinary` rank order.
- When two tasks share an active rank, compare valid `statusObservedAt` descending and never use
  message-driven activity as an active fallback.
- When two tasks share a non-active rank, preserve current activity-descending behavior.
- Resolve equal or unavailable timestamps with immutable `threadId` ascending.
- Keep the shared comparator in Focus, All, custom Domains, and global-search results.
- A snapshot that only advances a working task's `lastActivityAt` must not change its position.
- A newer valid working-state entry time may change position.
- Do not add persistence, migration, polling, App Server, or Hook behavior. Existing
  `statusObservedAt` is already persisted and reply metadata refresh does not mutate it.

## Expected paths

- `docs/issues/eyes-on-agents-working-order-churn.md`
- `docs/INDEX.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/eyes-on-agents.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `scripts/eyes-on-agents/global-title-search.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- The real renderer Store harness proves active tasks precede terminal unread tasks.
- Two working tasks with opposing activity/start timestamps sort by working-state start time.
- Advancing only the older task's activity leaves Focus, All, Domain, and search order unchanged.
- A newer working-state timestamp legitimately reorders the task.
- Equal and invalid/missing active timestamps use thread ID rather than activity/input order.
- Existing waiting and non-active activity ordering remain unchanged.
- Run the EyesOnAgents UI suite, focused renderer typecheck where available, and
  `git diff --check`. Do not launch Electron; Ral owns runtime verification.

## Review

- [eyes-on-agents-working-start-order-035-1](../reviews/eyes-on-agents-working-start-order-035-1.md)
  passed with no P1, P2, or P3 finding.

## Delivery evidence

- The shared renderer comparator preserves all attention ranks, uses `statusObservedAt` only inside
  active ranks, preserves activity ordering elsewhere, and finishes with immutable thread ID.
- The real Store harness covers Focus, All, custom Domain, and global-search ordering, including
  reply-only activity updates, genuine state-entry updates, invalid timestamps, and ties.
- `yarn test:eyes-on-agents` passes; independent verification also passed the 50-test UI suite and
  the 13-test focused Store harness. `git diff --check` passes.
- Focused renderer typecheck remains blocked only by the pre-existing unresolved `@preload/*`
  alias in unchanged `eyesOnAgentsEnv.bridge.ts`; no task-035 file is reported.
- No Electron process was launched. Ral owns the pointer-stability runtime check.
