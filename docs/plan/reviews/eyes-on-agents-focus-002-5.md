# Review: eyes-on-agents-focus-002 (round 5)

## Verdict

**blocking** — both round 4 P1 findings are closed, but App Server-owned repository work still
escapes the observation teardown fence. An accepted notification can finish its repository write
and broadcast after `shutdown()`, explicit disconnect, or cleanup has completed final invalidation
and returned; the pre-connect App Server invalidation can likewise finish its write after return.

## Blocking finding

### [P1] App Server-owned repository work is neither completely fenced nor joined

`CodexAppServerSupervisor` deliberately dispatches notifications as detached work: the connection
generation is checked before invocation, then the callback promise is started without being awaited
(`src/main/eyesOnAgents/codexAppServer.supervisor.ts:441-463`). Once the callback has started,
disconnecting the supervisor cannot cancel or join it.

The service callback parses the event, awaits `repository.applyRuntimeEvent()`, and then notifies
unconditionally. It captures no observation signal/epoch, performs no intake/abort check, and does
not register its promise in any active-work set
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:611-650`). Teardown only joins hook writes, Sync,
desktop setup, and bridge inspection; App Server notification work is absent from that set
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:293-303`).

A deterministic failure trace is therefore:

1. A valid `turn/started`, `turn/completed`, or `thread/status/changed` notification enters
   `handleAppServerNotification()` and blocks inside `repository.applyRuntimeEvent()`.
2. `shutdown()` or `disconnectAppServer()` aborts hook/Sync intake, disconnects the App Server,
   observes no joined work, performs final hook invalidation, and returns
   (`src/main/eyesOnAgents/eyesOnAgents.service.ts:306-340`).
3. The blocked repository promise is released. The old observation writes its App Server event and
   calls `notify()` after teardown finalization. This can publish stale activity from the previous
   connection generation and violates the no-write/no-notify-after-return boundary.

The existing teardown regressions only delay Codex hook persistence. They prove pending inspection,
buffer drain, and hook-intake fencing, but do not route a delayed App Server notification through
`handleAppServerNotification()` (`scripts/eyes-on-agents/core.test.mjs:886-1054`).

There is a second trigger for the same invariant. `ensureAppServerConnected()` awaits
`repository.invalidateAppServerStatuses()` before `performSync()` is registered in
`activeSyncOperations` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:225-231,534-542`). If that
write is gated while the App Server is disconnected, teardown has nothing to join and can return;
releasing the gate then completes an observation-owned repository write after return. The following
signal check correctly prevents `appServer.connect()`, and the invalidation is fail closed, but
neither fact satisfies the promised lifetime boundary.

Required before acceptance:

- Bind App Server notification handling to the current observation signal or generation and reject
  notification intake once teardown starts.
- Register every accepted notification operation before its first asynchronous boundary in work
  joined by `joinDesktopObservationWork()`; teardown must not reach final invalidation or return
  while its repository write is unresolved.
- Include the pre-connect `invalidateAppServerStatuses()` operation in the same joined observation
  boundary, so concurrent ensure/teardown cannot leave even a fail-closed clearing write behind.
- After an abort, do not broadcast the old notification. Preserve the existing repository timestamp
  ordering, and ensure reconnect cannot admit work from the aborted controller/generation.
- Add deterministic regressions with gated `repository.applyRuntimeEvent()` and
  `repository.invalidateAppServerStatuses()`: shutdown and explicit disconnect must wait for
  accepted work, block later intake, place all allowed write/notify activity before final
  invalidation, and emit nothing from the old observation after return. The shared cleanup path
  should also cover `removeCodexBridge()`.

## Round 4 P1 resolution

### Listener replacement during buffer drain — resolved

- A flush that loses its listener lifetime returns `replaced`; inspection invalidates the old hook
  evidence and loops into a fresh `hooks/list` for the current lifetime before returning
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:420-453,454-500`).
- Concurrent Connect/Sync callers share `bridgeInspectionPromise`, so neither enters `thread/list`
  while the replacement inspection is pending (`src/main/eyesOnAgents/eyesOnAgents.service.ts:503-543`).
- The drain-time replacement regressions require two inspections, place the replacement event after
  the second `hooks/list` and before pagination, and reject a non-installed replacement without
  consuming its terminal event (`scripts/eyes-on-agents/core.test.mjs:798-884`).

### Hook inspection/drain/Sync teardown — resolved for the tracked paths

- Teardown disables intake and aborts the current controller before stopping dependencies; setup
  waits for active teardown and creates a fresh controller on reconnect
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:234-251,324-340`).
- Buffered and already-trusted direct hook writes use the same synchronously registered
  `activeHookWrites` path; Sync is registered in `activeSyncOperations`; teardown repeatedly joins
  both sets plus setup and inspection before final invalidation
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:293-303,514-543,653-714`).
- The cancellable `hooks/list` and `thread/list` races attach both fulfillment and rejection
  handlers to losing promises. Once aborted, their later settlement cannot resume service mutation
  or produce an unhandled rejection (`src/main/eyesOnAgents/eyesOnAgents.service.ts:399-417,
  454-532`). The pending-inspection regression also proves reconnect uses a fresh inspection while
  the old losing request may remain unresolved (`scripts/eyes-on-agents/core.test.mjs:886-946`).
- Pending and flushing overflow remain bounded and fail closed. Overflow clears the queue, rejects
  the lifetime, invalidates partially applied hook evidence, and never falls back to trusted
  admission (`src/main/eyesOnAgents/eyesOnAgents.service.ts:381-397,420-500`).

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, repository, App Server, bridge, and UI suites exited 0. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped strict main/shared/preload check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped strict EyesOnAgents Vue check exited 0. |
| `yarn build` | pass (reused) | The current develop round reported the full build passing; round 5 did not rerun it. |
| `git diff --check` | pass | Exited 0 after this review artifact was added. |

## Conclusion

**blocking** — listener replacement and the hook/Sync teardown paths now satisfy the requested
lifetime and join semantics, including fresh-controller reconnect and fail-closed overflow. The
teardown boundary is still incomplete until detached App Server notification work participates in
the same intake fence and join, and pre-connect invalidation is also joined, with regressions proving
no old-generation write or notification can cross final invalidation or return.
