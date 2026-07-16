# Review: eyes-on-agents-001 (round 1)

## Findings

### P2 · blocking — `notLoaded` can revive stale work after an App Server reconnect

- The contract requires `notLoaded -> unknown` and forbids treating a separate/new managed App
  Server as evidence that a Codex Desktop task is still active
  (`docs/integrations/eyes-on-agents.md`, “Product boundary” and “Runtime state”). The normalizer does
  initially map `notLoaded` to `unknown`, but labels it `discovery`
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:122-130`).
- The repository deliberately refuses to update `runtime_state`, flags, source, or observation time
  whenever an incoming sync row has source `discovery`
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:207-240`). Therefore a row previously persisted as
  `app_server/working` survives a reconnect even when the new server explicitly lists it as
  `notLoaded`.
- Snapshot projection then considers every persisted `app_server` active state current whenever
  *any* managed server child is connected; it does not bind evidence to the child generation
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:171-182`,
  `src/main/eyesOnAgents/eyesOnAgents.service.ts:120-140`). Focus can consequently show a stale task
  as actively working after reconnect, which is the exact false-positive boundary this delivery is
  meant to prevent.
- A real local Codex `0.137.0` handshake and one-row `thread/list` probe succeeded and returned
  `status.type = notLoaded`, confirming this is the ordinary separate-server response rather than a
  hypothetical malformed payload.
- **Required fix:** make an observed `notLoaded` invalidate prior status owned by an earlier managed
  server generation without erasing newer Desktop-hook evidence. Persist or otherwise carry an
  App Server generation/ownership identity, and add a regression for
  `server A working -> exit -> server B notLoaded -> snapshot unknown/not focused`.

### P2 · blocking — late events from an old child can tear down or corrupt the replacement child

- Every child listener closes over no child identity and calls handlers that mutate one shared
  `child`, stdout buffer, stderr tail, pending map, and connection state
  (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:95-108,161-168`).
- On a stream/process failure, `terminateChild()` clears `this.child` before the old process has
  necessarily emitted `close`; the state is already `error`, so a user retry may start and assign a
  replacement child. When the old child's delayed `close` then runs, `handleClose()` unconditionally
  sets `this.child = null`, rejects the shared pending requests, and changes the replacement's state
  to `error` (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:338-352`). Late stdout or
  notifications from the old child likewise flow through the new generation's shared parser.
- This violates the one-main-owned persistent connection and clean reconnect lifecycle. A routine
  retry after an unexpected exit can lose an otherwise healthy replacement process and can apply
  notifications from a server no longer owned as current.
- **Required fix:** bind listeners, buffers, pending requests, and close/failure handling to a child
  generation (or exact child identity), ignore all stale-generation callbacks, and await/serialize
  replacement around teardown. Add a deterministic fake-child test in which child B connects before
  child A emits its delayed `close`; B must remain connected and own all subsequent requests/events.

### P2 · blocking — legacy import bypasses the required UUID validator

- The task requires every thread UUID to be validated before persistence. Normal sync and runtime
  events use `parseEyesOnAgentsUuid`, but the migration inserts legacy IDs directly using only
  length, hyphen-position, and hex-character SQL predicates
  (`src/preload/sqlite/dao/eyesOnAgents.migration.ts:30-65`). It does not enforce the UUID version or
  variant that the shared validator requires.
- An executable SQLite probe showed that
  `00000000-0000-0000-0000-000000000000` passes the migration predicate. The row is then persisted,
  while snapshot hydration later rejects it in `toThread()` via `parseEyesOnAgentsUuid`
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:78-112`), allowing one invalid legacy row to break the
  entire board snapshot.
- **Required fix:** validate legacy candidates with the shared UUID parser inside the migration
  transaction (preferred), or make the SQL predicate exactly equivalent, and add a migration test
  proving invalid version/variant IDs are skipped while valid Codex IDs still import idempotently.

No P1 finding was found. P3 observations were intentionally omitted while blocking contract issues
remain.

## Contract review

| Contract | Result | Evidence |
|---|---|---|
| Codex-only surface / no fake messaging | pass | Active EyesOnAgents runtime, renderer, and tests have no Claude adapter/copy, composer, `turn/steer`, or invented queue API. The legacy provider-neutral feature paths are removed and historical docs are marked superseded. |
| Persistent App Server handshake and paging | partial / blocked | Shell-free stdio spawn, initialize/initialized, paged `thread/list`, error state, and owned-process shutdown are implemented and focused tests pass. Generation ownership and reconnect truthfulness are blocked by Findings 1-2. |
| SQLite model, default Domain, deletion transaction | pass except legacy validation | Dedicated tables seed immutable Uncategorized. Sync preserves assignment; custom Domain deletion reassigns and soft-deletes in one tested transaction; a trigger-induced failure rolls both operations back. Finding 3 blocks the import boundary. |
| Completion/open identity and successful-open ordering | pass for covered path | Open awaits `shell.openExternal` before `markOpened`; the focused test proves failed opens do not mark read. Repository coverage proves an opened synthetic hook turn remains read on completion and a later turn becomes unread. |
| Focus projection and order | pass subject to runtime truthfulness | Renderer order is approval, input, working, completed-unread, then latest activity. Focus is a projection and drag uses clone semantics. Finding 1 can still feed it false active state. |
| Standalone window / Mini Apps / lifecycle | pass subject to reconnect blocker | Mini Apps launches a creation-locked singleton with `1120x720`, `800x600` minimum, production-safe preload/renderer paths, auth destruction, and host-quit cleanup. The obsolete Home route is removed. |
| Domain interaction and fallback movement | pass by source and focused checks | Uncategorized is fixed outside the draggable custom-Domain list; create, rename, reorder, delete, cross-column drag, Focus clone drag, and the per-card Domain selector all call typed one-parameter XPC methods. |
| Hook privacy and preservation | pass | The bridge emits only allowlisted lifecycle metadata, rejects non-Codex provider arguments, preserves unrelated hook settings/handlers, repairs only Bitterless-owned shim entries, and removes only those entries in the executable fixture. |
| i18n and reduced motion | pass | English/Chinese EyesOnAgents trees are type-aligned; the tenth renderer entry waits for shared language initialization. The working pulse and board transition have reduced-motion overrides. |

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass but missing blocker regressions | Core, repository, App Server, bridge, and three UI source tests all exited 0. None covers server-generation replacement, stale-active followed by `notLoaded`, or an invalid legacy UUID. |
| Scoped core typecheck | pass | `yarn typecheck:eyes-on-agents:core` exited 0. |
| Scoped UI typecheck | pass | `yarn typecheck:eyes-on-agents:ui` exited 0. |
| Renderer i18n check | pass | `yarn check:renderer-i18n` exited 0 with EyesOnAgents in the fixed ten-entry inventory. |
| Production build | pass | `yarn build` emitted main, `out/preload/eyesOnAgents.js`, and `out/renderer/eyesOnAgents/index.html`; Vite completed successfully. |
| Real App Server read-only smoke | pass / exposes Finding 1 input | The installed Codex binary accepted initialize/initialized and `thread/list`; the sampled thread was `notLoaded` and a next cursor was present. No prompt or transcript data was printed. |
| Full `yarn typecheck` | baseline failure | It failed on existing Connector, Coin, Poker, Home, Maestro, Omni, Todo, and shared-helper diagnostics. No diagnostic referenced an EyesOnAgents file; both task-scoped semantic checks passed. |
| `git diff --check` | pass | Exited 0. |
| Electron visual smoke | not accepted this round | Build and renderer source checks passed, but visual acceptance is deferred until the runtime truthfulness and reconnect blockers are repaired. |

## Conclusion

**changes required** — the Codex-only standalone board, Domain model, Focus/read persistence,
Mini Apps entry, hook privacy boundary, i18n, scoped tests, and production build are substantially in
place. Delivery cannot be accepted while `notLoaded` can revive stale active work, an old App Server
child can invalidate its replacement, and migration can persist a thread ID that the board itself
cannot hydrate.
