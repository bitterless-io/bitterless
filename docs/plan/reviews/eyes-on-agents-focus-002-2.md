# Review: eyes-on-agents-focus-002 (round 2)

## Verdict

**accepted** — both round 1 P1 event-loss races are closed. No new P1 or P2 finding was found in
the current diff.

## Round 1 blocker resolution

### Listener-start invalidation race — resolved

- Desktop observation setup now has a service-level single-flight promise, so concurrent
  `connectAppServer()` and `syncThreads()` callers await one observation transition rather than
  independently invalidating the same listener lifetime
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:100-103,215-223`).
- When no listener is active, persisted hook-active evidence is invalidated before
  `bridgeListener.start()` can make the socket receive a current-lifetime event
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:225-233`). There is no old-lifetime invalidation
  after a trusted listener is opened. A second invalidation occurs only while the resulting bridge
  is not `installed`, when the event gate rejects hook events by design.
- The service-order regression now requires `invalidate-hook` before `listener-start`, and the
  delayed concurrent connect/sync test exercises both public entry points through one pending
  initialization (`scripts/eyes-on-agents/core.test.mjs:533-547`;
  `scripts/eyes-on-agents/app-server.test.mjs:388-410`).

### Trust-inspection / pagination race — resolved

- `performSync()` now finishes `refreshBridgeInspection()` before starting `thread/list`, matching
  the integration contract's connection sequence
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:243-263`;
  `docs/integrations/eyes-on-agents.md:83-92`).
- Once the inspection reports exact enabled trusted/managed hooks, an event received while
  `thread/list` is in flight passes the bridge state and current-listener timestamp gate and is
  persisted; a `needs_trust` result rejects the same event
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:377-418`).
- Deterministic regressions inject `UserPromptSubmit` from inside the thread-list interval. The
  trusted case must persist `turn_started` before discovery upsert, while the untrusted case must
  persist no runtime event (`scripts/eyes-on-agents/core.test.mjs:496-559`). The App Server test also
  asserts the first `hooks/list` request precedes the first paged `thread/list` request
  (`scripts/eyes-on-agents/app-server.test.mjs:413-417`).

## Safety and behavior sweep

- Trust still fails closed: events require bridge state `installed`, an active listener, a valid
  listener start time, and `occurredAt >= listeningSince`. Restarted-listener evidence cannot be
  revived from a prior lifetime.
- Untrusted/disabled/modified/missing hook definitions remain outside Focus, while the approved
  bridge keeps long-running active evidence without the former 60-second expiry.
- Explicit disconnect still stops the owned listener, removes only the Bitterless definitions,
  and invalidates active hook state while preserving completion/open markers.
- The fix adds no transcript, prompt, tool payload, hook command, or arbitrary JSON-RPC surface to
  SQLite, XPC, or the renderer.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, repository, App Server, bridge, and UI suites exited 0, including the new ordering/trust regressions. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped main/shared/preload strict check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped EyesOnAgents Vue strict check exited 0. |
| `yarn build` | pass | Current round 2 main, preload, and renderer sources built successfully; the EyesOnAgents main chunk and standalone renderer were emitted. |
| `git diff --check` | pass | Exited 0 before this review artifact was added. |

## Conclusion

**pass / accepted** — old hook evidence is invalidated before a new listener can accept events,
concurrent observation setup is merged, hook trust is established before thread pagination, and
the trusted/untrusted pagination behaviors are both executable regressions.
