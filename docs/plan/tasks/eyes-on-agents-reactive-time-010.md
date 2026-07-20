---
id: eyes-on-agents-reactive-time-010
scope: make EyesOnAgents relative activity time reactive
status: done
depends-on: [eyes-on-agents-thread-card-009]
---

# EyesOnAgents Reactive Thread Time

## Objective

Maintain one renderer-global reactive `currentTime` value, update it every 10 seconds, and derive
every `thread-card__time` label from that value so visible relative times advance without a new
thread snapshot.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)

## Required behavior

- Add a dedicated EyesOnAgents global reactive store with `currentTime` represented as epoch
  milliseconds.
- The global store owns one idempotent current-time loop. Starting it refreshes `currentTime`
  immediately, then updates it every `10_000` milliseconds.
- The application starts the loop on mount and stops it on unmount so hot reload or window teardown
  cannot accumulate intervals.
- `ThreadCard` computes relative activity from the global store's `currentTime`, never directly from
  `Date.now()`, and never creates a per-card interval.
- Clock ticks are presentation-only: they do not call XPC, refresh snapshots, inspect Hooks, or
  persist data.
- Preserve all current timestamp fallbacks and labels: `lastActivityAt`, then `lastCompletedAt`,
  invalid/missing values as `Unknown`, and minute/hour/day output rules.
- Extend the renderer source guard to prevent direct `Date.now()` and per-card timers from returning.

## Expected paths

- `docs/integrations/eyes-on-agents-layout.md`
- `docs/integrations/eyes-on-agents.md`
- `src/renderer/eyesOnAgents/src/store/global.store.ts`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Static source review confirms one store-owned `10_000` ms interval with idempotent start and
  cleanup.
- Static source review confirms `ThreadCard` depends on reactive `currentTime`, contains no
  `Date.now()` and owns no timer.
- Existing relative-time fallbacks and thresholds remain unchanged.
- The owner performs runtime Electron verification; the agent does not launch Electron.
