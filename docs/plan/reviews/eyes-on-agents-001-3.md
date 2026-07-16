# Review: eyes-on-agents-001 (round 3)

## Findings

No P1 or P2 findings.

## Round 2 blocker resolution

### Delayed initialization / concurrent connect and sync — resolved

- `isConnected()` now reports ready only when the exact current connection is in `connected` or
  `syncing`; a spawned child whose handshake is still `connecting` is no longer exposed as ready
  (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:124-126`).
- A second service call therefore does not short-circuit
  `EyesOnAgentsService.ensureAppServerConnected()` while initialization is pending. It enters
  `connect()`, whose first guard awaits the existing `connectPromise`, before either caller reaches
  `listThreads()` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:176-195`,
  `src/main/eyesOnAgents/codexAppServer.supervisor.ts:145-155,253-257`).
- The checked-in delayed-initialize regression starts `connectAppServer()` and `syncThreads()`
  together, holds the fake child's initialize response, and verifies: connecting is not ready, the
  sync remains pending, only one child is spawned, only one initialize/initialized handshake occurs,
  and both service calls successfully sync after release
  (`scripts/eyes-on-agents/app-server.test.mjs:102-121,249-333`).
- An independent review probe bundled the current supervisor and service into memory and repeated
  the same sequence with a separately defined controlled child. Before release, both outcomes were
  pending, `state === 'connecting'`, and `isConnected() === false`. After release, both resolved;
  counters showed one spawn, one `initialize`, one `initialized`, and two successful one-page
  `thread/list` requests.

## Earlier blocker regression sweep

| Blocker | Result | Evidence |
|---|---|---|
| Reconnect / `notLoaded` must not revive old App Server activity and must preserve hook ownership | pass | Discovery always carries the current observation time; reconnect invalidation only clears `app_server`; newer discovery replaces old managed-server state but leaves `codex_hook` untouched (`src/main/eyesOnAgents/eyesOnAgents.service.ts:68-92,182-195`; `src/preload/sqlite/dao/eyesOnAgents.dao.ts:199-305`). Repository and service regressions remain in the passing suite. |
| Delayed stdout, notification, or close from an old child must not affect its replacement | pass | Per-connection state and exact-connection guards remain on requests, parsing, notifications, failures, and closes (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:17-24,304-422`). The child A / child B delayed-event regression still passes. |
| Legacy import must reject bad UUID version, variant, and extra hyphens | pass | Migration retains canonical positions, exact hyphen count, hex-only content, version `1-8`, and variant `8/9/a/b` predicates (`src/preload/sqlite/dao/eyesOnAgents.migration.ts:56-68`). The valid/import-once plus invalid-version/variant/hyphen regression still passes. |
| Connecting child must not be treated as ready | pass | Readiness, shared promise, checked-in delayed-handshake test, and independent probe all agree; both concurrent service operations finish through one handshake. |

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, repository, App Server, bridge, and UI-focused suites all exited 0. |
| Independent delayed-initialize probe | pass | Concurrent connect + sync shared one spawn/handshake and both resolved after release. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped main/shared/preload semantic check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped renderer semantic check exited 0. |
| `yarn check:renderer-i18n` | pass | Renderer language inventory and EyesOnAgents keys passed. |
| `yarn build` | pass | Main, EyesOnAgents preload, and standalone EyesOnAgents renderer artifacts were emitted successfully. |
| `git diff --check` | pass | Exited 0 after the verification run. |

The full repository-wide typecheck was not repeated because previous rounds established unrelated
baseline diagnostics outside EyesOnAgents. Both task-scoped typechecks and the production build pass.

## Conclusion

**pass / accepted** — the delayed-initialize race is fixed and independently reproduced as passing,
all four prior P2 blockers retain executable coverage, and this round found no new P1 or P2 issue.
