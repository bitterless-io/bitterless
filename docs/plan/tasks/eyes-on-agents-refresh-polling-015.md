---
id: eyes-on-agents-refresh-polling-015
scope: one non-overlapping ten-second EyesOnAgents thread refresh poll
status: done
depends-on: [eyes-on-agents-menubar-domain-guide-014]
---

# EyesOnAgents Ten-second Refresh Polling

## Objective

Refresh the Codex thread inventory every ten seconds while EyesOnAgents is mounted, with exactly one
polling interval and no overlapping or queued refresh requests.

## Context

- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Codex observation](../../features/eyes-on-agents-codex-observation.md)
- [Activation refresh](eyes-on-agents-activation-refresh-004.md)
- [Reactive presentation time](eyes-on-agents-reactive-time-010.md)

## Required behavior

- Add one store-owned `10_000` millisecond inventory polling interval. Starting it repeatedly is an
  idempotent no-op while its timer exists.
- Start the interval when the EyesOnAgents root renderer mounts. Stop it on unmount, clear the window
  interval, and reset the stored handle to `null`. Start it before the mount callback's first `await`
  so unmount during initial snapshot loading cannot be followed by a late timer start.
- Reuse the existing `syncThreads()` XPC path. Do not add another renderer emitter, main handler,
  discovery service, timer per card/component, or direct Hook-inspection polling call. The existing
  full sync may transitively refresh observation artifacts; it does not require a second timer.
- A connected tick synchronizes. A disconnected/error tick synchronizes only when auto-connect is
  enabled. An explicit Disconnect remains authoritative and is never undone by the timer.
- If snapshot loading, connecting, synchronization, or any other board action is in flight, drop the
  current tick without queuing a retry. A refresh lasting beyond the next tick must remain the only
  request.
- Catch timer-triggered failures at the interval boundary while preserving the store's existing
  action error and last-snapshot behavior. Manual Refresh and focus activation remain unchanged.
- Keep the renderer-global relative-time clock independent and presentation-only. It may have its
  own ten-second interval; there must still be exactly one inventory-refresh polling interval.

## Path

- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-refresh-polling-015.md`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Independent static review confirms one idempotent store-owned timer, mount/unmount lifecycle,
  `10_000` timing, connection-intent guard, busy/load skip, rejected-promise handling, and reuse of
  `syncThreads()`.
- Source guards prevent duplicate polling timers, missing cleanup, overlap/queue behavior, and a
  separate Hook-inspection call from entering the renderer polling callback. They also require timer
  start before the mount callback's first `await`.
- Per owner instruction, do not launch Electron or run tests, builds, formatter, or typecheck; Ral
  performs the runtime verification.

## Review

- Round 1: [eyes-on-agents-refresh-polling-015-1](../reviews/eyes-on-agents-refresh-polling-015-1.md)
  — blocked because full `syncThreads()` transitively inspects observation artifacts while the first
  contract incorrectly prohibited that behavior; it also found a missing mount-order source guard.
- Round 2: [eyes-on-agents-refresh-polling-015-2](../reviews/eyes-on-agents-refresh-polling-015-2.md)
  — accepted after the contract accurately distinguished reused full-sync inspection from a second
  Hook poll and the timer-start-before-`await` guard was added; no P1/P2/P3 finding remains.
