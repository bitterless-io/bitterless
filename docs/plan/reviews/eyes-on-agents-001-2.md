# Review: eyes-on-agents-001 (round 2)

## Findings

### P2 · blocking — `connecting` is exposed as connected, so a concurrent sync can run before initialization

- The supervisor assigns its new connection before the `initialize` request completes
  (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:174-195`). During that interval its state is
  still `connecting`, but `isConnected()` returns `true` for every state except `disconnected` and
  `error` (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:124-126`).
- `EyesOnAgentsService.ensureAppServerConnected()` treats that boolean as readiness and returns
  without awaiting the in-flight `connectPromise`
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:176-195`). It then calls `listThreads()`, whose own
  guard correctly rejects the same `connecting` state as not connected
  (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:253-257`). The readiness contract is therefore
  internally contradictory.
- This is reachable through the public XPC service methods, which are not serialized at the main
  boundary (`src/main/xpc/eyesOnAgents.handler.ts:87-97`). The renderer currently suppresses most
  duplicate button actions with `busyAction`, but that UI guard does not make the main-owned service
  concurrency-safe and does not cover lifecycle/XPC overlap or another caller.
- A deterministic second-round probe held a fake child's `initialize` response, started
  `connectAppServer()`, then called `syncThreads()`. It confirmed `state === 'connecting'` together
  with `isConnected() === true`, and the second call failed with `Codex App Server is not connected`.
- **Required fix:** make `isConnected()` mean initialized/ready (or otherwise make
  `ensureAppServerConnected()` always await an in-flight connect), so the second call joins the
  existing `connectPromise`. Add a delayed-initialize regression proving concurrent connect + sync
  uses one child and both operations complete successfully.

No P1 finding was found.

## Round 1 finding resolution

### 1. Stale App Server state after reconnect / `notLoaded` — resolved

- Every parsed discovery result, including `notLoaded`, now carries the current observation time
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:68-92`). Before starting a replacement server, the
  service invalidates status owned by the previous managed App Server
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:182-186`).
- Repository invalidation only clears rows whose source is `app_server`, while the discovery UPSERT
  allows newer `notLoaded` evidence to clear `app_server`/`discovery` state and preserves
  `codex_hook`-owned state (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:199-216,218-305`).
- Executable repository regressions cover old App Server working state becoming unknown/unfocused,
  direct newer `notLoaded` replacement, and preservation of hook-owned working state across both
  discovery and reconnect invalidation
  (`scripts/eyes-on-agents/repository.test.mjs:286-370`). The service test also verifies
  `invalidate -> connect -> list -> upsert` and the `notLoaded` observation timestamp
  (`scripts/eyes-on-agents/core.test.mjs:194-251`).

### 2. Delayed events from a replaced child — resolved

- Child identity, generation, stdout/stderr buffers, pending requests, and disconnect ownership are
  now encapsulated per connection (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:17-24,103-115`).
  Requests, messages, queued notifications, failures, and closes all verify the exact current
  connection before mutating state (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:304-414`).
- The deterministic replacement-child regression delivers delayed stdout/notification/close from
  child A after child B connects. It proves B remains connected, only B's notification is delivered,
  and all replacement `thread/list` requests go to B
  (`scripts/eyes-on-agents/app-server.test.mjs:162-211`).

### 3. Legacy UUID migration validation — resolved

- The migration now enforces UUID length and canonical hyphen positions, exactly four hyphens,
  hexadecimal-only remaining characters, version `1-8`, and RFC variant `8/9/a/b`
  (`src/preload/sqlite/dao/eyesOnAgents.migration.ts:56-68`).
- The executable migration test proves that wrong-version, wrong-variant, and extra-hyphen IDs are
  all rejected while a valid Codex ID imports exactly once and a Claude row remains excluded
  (`scripts/eyes-on-agents/repository.test.mjs:13-15,128-172`).

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, repository, App Server, bridge, and UI-focused suites exited 0, including all three round-1 regressions. |
| Delayed-initialize concurrency probe | fail / exposes finding | Controlled fake child reproduced concurrent connect + sync failing before `initialize` completed. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped main/shared/preload semantic check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped renderer semantic check exited 0. |
| `yarn check:renderer-i18n` | pass | Renderer language inventory and EyesOnAgents keys passed. |
| `yarn build` | pass | Main, EyesOnAgents preload, and standalone renderer artifacts were emitted successfully. |
| `git diff --check` | pass | Exited 0. |

The full repository-wide typecheck was not repeated: round 1 already established unrelated baseline
diagnostics outside EyesOnAgents, while both scoped semantic checks and the production build pass in
this round.

## Conclusion

**changes required** — all three round-1 P2 findings are genuinely fixed and their regressions pass,
but acceptance remains blocked by the newly confirmed initialization race. A concurrent service
call must await the App Server handshake instead of treating `connecting` as ready.
