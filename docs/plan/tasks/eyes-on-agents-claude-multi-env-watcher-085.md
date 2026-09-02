---
id: eyes-on-agents-claude-multi-env-watcher-085
scope: Run one independent JSONL/Desktop watcher supervisor per configured Claude environment
status: done
depends-on: [eyes-on-agents-claude-multi-env-data-model-084]
verify: focused EyesOnAgents service unit tests, Core strict typecheck; no Electron
---

# EyesOnAgents Claude Multi-Environment Watcher

## Objective

Move `ClaudeObservationService` from one `appliedConfig`/`generation`/`status`/watcher-supervisor to
a map keyed by environment `id`, so each configured environment gets its own independent watcher
child process, retry ladder, and status — one environment's failure/retry never touches another's.

## Context

- `docs/features/eyes-on-agents-claude-multi-environment.md` — "Watcher" section is the exact
  contract for this task.
- `docs/features/eyes-on-agents-claude-observation.md` — "Claude directory lifecycle and
  configuration" section (the retry ladder, ready handshake, and fail-closed rules this task
  generalizes to per-environment).

## Required behavior

- `ClaudeObservationService` (`src/main/eyesOnAgents/claudeObservation.service.ts`) holds a
  `Map<environmentId, ClaudeEnvironmentObservationState>`, each entry independently owning its own
  `appliedConfig` (exactly one `EyesOnAgentsClaudeEnvironment`), `generation` fence,
  `ClaudeWatcherSupervisor` instance, and `1s -> 5s -> 15s -> 30s -> 60s` bounded retry timer. This
  replaces the current single-instance fields; it does not add a second parallel code path.
- Enabling/adding an environment starts its own supervisor with inventory roots resolved from that
  one environment's `desktopRoots`/`projectsRoot` (`claudePath.resolver.ts`'s existing
  `ClaudeObservationRoots` resolution, called once per environment). Disabling/removing an
  environment stops and joins only that environment's supervisor; every other environment's
  generation, retry timer, and status are untouched.
- A disabled environment reports `state: "stopped"` and has no running supervisor; this is a
  deliberate pause, not a failure, and must never enter the retry ladder.
- `EyesOnAgentsClaudeDirectoryStatus` becomes `EyesOnAgentsClaudeEnvironmentStatus[]` — one entry per
  configured environment, carrying every existing field (`mode`, `configuredDirectory`,
  `effectiveDirectory`, `projectsDirectory`, `desktopDirectoryCount`, `state`, `watching`,
  `lastScanAt`, `lastSuccessfulScanAt`, `nextRetryAt`, `error`) plus `id`, `label`, `enabled`. Update
  the snapshot type in `eyesOnAgents.type.ts` and every place that currently reads the singular
  status object.
- The existing content-free `ready` handshake, fatal-watcher-error generation teardown, and
  Main-owned bounded retry timer semantics are unchanged in kind — only their cardinality changes
  from one to N independent instances. Do not weaken any existing fail-closed rule while
  generalizing it.
- Application shutdown, logout, and provider disable must stop and join every environment's
  supervisor, not just one — audit every call site that currently stops "the" watcher and make sure
  it now iterates the full map.
- Logging: extend the existing watcher lifecycle log lines (start, ready, retry, fatal
  generation teardown) to include that environment's `id`/`label`; keep the same `main.log`
  destination and `[scope]` convention already used for this subsystem. `configDirectory` values are
  never logged (unchanged rule from task 084).

## Path

- `src/main/eyesOnAgents/claudeObservation.service.ts`
- `src/main/eyesOnAgents/claudeWatcher.supervisor.ts` (only if per-instance state needs adjusting;
  the CLI-arg/root-list plumbing itself should already support one process per environment without a
  rewrite — confirm this before changing it, and keep changes minimal if so)
- `src/main/eyesOnAgents/claudePath.resolver.ts` (only if its signature needs to accept one
  environment instead of the old singular config; keep its actual root-resolution logic unchanged)
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (status type)
- every call site that stops/starts "the" Claude watcher on shutdown/logout/provider-disable —
  find them via the existing single-instance field references and update each to iterate the map
- a new or extended focused test file under `scripts/eyes-on-agents/` (e.g.
  `claude-environment-watcher.test.mjs`)

## Verification

- New tests cover: two environments with independent watcher lifecycles — starting/stopping/
  retrying one never changes the other's `state`/`nextRetryAt`/`error`; disabling an environment
  produces `state: "stopped"` without entering retry; removing an environment joins its supervisor
  cleanly; shutdown/logout stops every environment's supervisor, not just the first.
- Run the new/extended test file, the existing Claude observation/watcher test suite (find and run
  it — it must not regress against the now-map-based service), and `yarn typecheck:eyes-on-agents:core`.
- Confirm via a targeted test or direct trace that a log call for one environment's retry/error never
  contains another environment's `id`, and never contains any `configDirectory` value.
- Do not launch Electron.

## Implementation evidence

- `src/main/eyesOnAgents/claudeObservation.service.ts` was rewritten around a single
  `private readonly environments = new Map<string, ClaudeEnvironmentObservationState>()`, replacing
  every former single-instance field (`appliedConfig`, `appliedResolution`, `generation`, `started`,
  `capabilityClearPending`, `retryTimer`, `retryAttempt`, `status`, `refreshPromise`,
  `refreshRequestedMode`, `desktopColdOffset`, `transcriptColdOffset`, `lifecycleTail`) with the same
  fields owned per `ClaudeEnvironmentObservationState` entry, each with its own `watcher` instance
  (from a new `createWatcher: (environment) => ClaudeEnvironmentWatcher` factory dependency, replacing
  the old single `watcher: {...}` dependency) and its own `lifecycleTail` promise chain
  (`runEnvironmentLifecycle`). A separate, smaller service-level queue (`serviceLifecycleTail` /
  `runServiceLifecycle`) serializes whole-service operations (`start`, `stop`, hydration, the CRUD
  reconciliation entry point) — every per-environment body function assumes it already holds that one
  environment's lock and never calls back into `runEnvironmentLifecycle` for the same entry (that
  would deadlock on the promise chain); only genuine external entry points
  (`handleWatcherFailure`, `invalidate`, the retry timer's own fire callback, and
  `reconcileEnvironments`'s per-environment dispatch) wrap a `*Body` method in that one call.
- **Reconciliation entry point (new, not explicitly named in the design doc):**
  `ClaudeObservationService.applyEnvironments()` — a public, no-argument method that re-reads
  `directoryConfig.listEnvironments()` and diffs the map against it (tears down removed ids, starts
  newly-added ones if enabled/desired, and applies rename/mode/directory/enabled changes to existing
  ones). `changeDirectory()`/`useAutomaticDirectory()` (the legacy default-environment actions) now
  call the same reconciliation body after mutating `environments[0]`. `src/main/xpc/eyesOnAgents.handler.ts`'s
  six environment-CRUD XPC methods (`addClaudeEnvironment`, `renameClaudeEnvironment`,
  `removeClaudeEnvironment`, `setClaudeEnvironmentEnabled`, `chooseClaudeEnvironmentDirectory`,
  `useAutomaticClaudeEnvironment` — added by task 084, which deliberately left them **not** calling
  into `claudeObservation` at all) each now call `claudeObservation.applyEnvironments()` once after
  persisting their mutation. This file is not in this task's Path list, but without this one-line
  addition per method, "enabling/adding an environment starts its own supervisor; disabling/removing
  stops one" would only be true as an internal service capability, never actually true end-to-end —
  the Required Behavior section describes the end-to-end contract, so this wiring was added.
- **Invalid/not-yet-hydrated directory configuration:** when `ClaudeDirectoryConfigService.hydrate()`
  reports `state: 'invalid'` (malformed persisted value) or itself throws, no environment identity is
  known yet, so there is nothing to key a map entry by. `getDirectoryStatus()` falls back to
  `EyesOnAgentsClaudeDirectoryStatus` being a single-entry array (`invalidHydrationStatus`, `id`/`label`
  empty) — `state: 'error'` for a malformed value (matches the pre-084 "stays stopped with a bounded
  error until Use automatic or a new directory selection replaces it" contract: no auto-retry) or
  `state: 'retrying'` for a thrown read error (bounded auto-retry via a dedicated, service-level
  `hydrationRetryTimer`, independent of any per-environment retry timer). This exactly generalizes the
  pre-085 singleton's one fixed status object for this same case; it is documented in the design doc's
  Watcher section as an implementation note.
- **`ClaudeWatcherSupervisor` inventory-bridge socket/pipe collision (hard bug, fixed):** the design
  doc's Watcher section says the supervisor "already spawns one child process per call site," which is
  true for the child process itself, but `getClaudeInventoryBridgeEndpoint(userDataPath)`
  (`claudeInventoryBridge.contract.ts`) derived its Unix socket/named-pipe path from `userDataPath`
  alone — every environment's supervisor would have collided on the exact same endpoint path, so two
  simultaneously-running environments would never both work. Fixed by adding an optional third
  `environmentId` parameter to `getClaudeInventoryBridgeEndpoint`, threaded from a new optional
  `environmentId`/`environmentLabel`/`logger` triple on `ClaudeWatcherSupervisor`'s constructor
  dependencies. Omitting `environmentId` (every pre-085 caller and test) reproduces the exact previous
  path/pipe name — zero behavior change for the single-environment case. Documented as an
  implementation note in the design doc since this is a real mechanism the doc didn't call out.
- **Watcher lifecycle logging (`start`/`retry`/`fatal`/`ready`) is new, not "extended":** inspection of
  the pre-085 `claudeObservation.service.ts` and `claudeWatcher.supervisor.ts` found zero existing
  `console.*`/`electron-log` calls of any kind in either file — the design doc's and this task's own
  "extend the existing … log lines" phrasing assumed lines that did not exist. `start`/`retry`/`fatal`
  are logged from `claudeObservation.service.ts` via a new `logEnvironmentLifecycle(state, action,
  detail?)` private method (`[claude-watcher] action=<start|retry|fatal> id=<id> label="<label>"
  [detail]`, routed through an optional `logger` constructor dependency defaulting to `console`,
  matching `claudeDirectoryConfig.service.ts`'s existing convention); `ready` is logged from
  `claudeWatcher.supervisor.ts` itself (the only place that observes the raw IPC handshake frame),
  gated on `environmentId` being present so a bare pre-085-style supervisor (no `environmentId`, as
  constructed by every existing test) produces no log line at all. Every line was verified to omit
  `configDirectory` — see the new test file's log-content assertions below. Documented as an
  implementation note in the design doc.
- **`clearClaudeTranscriptCapabilities()` / Claude Agent View poll are still global, per-environment
  side effects (accepted limitation, not fixed):** both repository operations act across every Claude
  thread regardless of which root produced it — there is no per-root or per-environment scoping column
  for either (Hook attribution's `claude_config_dir`, task 087, is a raw path on thread rows, not a
  scope key usable here). Each environment's own `capabilityClearPending`/`agents.poll()` call is
  replicated verbatim per environment (exactly the pre-085 mechanism, run N times instead of once), so
  one environment (re)starting can transiently clear a sibling's already-scanned transcript
  capabilities until that sibling's own next scan repopulates them, and each environment polls Claude
  Agent View independently rather than once per service tick. This is out of this task's Path (no DAO
  schema change) and undiscussed by the design doc's Watcher section; recorded as an implementation
  note there, deliberately mirroring the same document's existing "Scope decisions" acceptance of the
  plugin bridge's shared, non-isolated installation identity.
- **`start()` status reset preserved:** the pre-085 singleton's `start()` synchronously wiped its one
  status object to an all-null `"starting"` shape *before* awaiting hydration, so a slow re-hydrate
  never displayed stale directory info from a previous run. The map-based `start()` now does the same
  for every already-known environment entry (label/id/enabled kept, resolution/mode/directory wiped),
  discovered as a real regression via the adapted `claude-directory-runtime.test.mjs`'s
  `resumeHydrateRuntime` scenario before this was added.
- **Per-environment `refresh()` deliberately has no eager-start fallback:** the pre-085 singleton's
  public `refresh()` had a service-level "not started yet but desired → call `start()`" fallback. A
  first attempt at this task translated that fallback into `refreshEnvironment` per environment, which
  reintroduced a real race: calling the public `refresh()` while a `start()`'s hydration was still
  in-flight would eagerly call `startEnvironmentBody` against a not-yet-reconciled, possibly-stale
  `state.config`. Removed entirely — starting an environment is always driven by
  `reconcileEnvironments()`/`applyEnvironmentConfigBody()`; `refreshEnvironment` now simply returns
  `{ changed: false }` for a not-yet-started environment. The service-level `refresh()`'s own
  "not started → call `this.start()`" fallback is unchanged and still the only place this pattern
  exists, matching the pre-085 contract exactly.
- **`applyEnvironmentConfigBody` 3-branch structure (root unchanged / same effective directory /
  genuine root change), each gated by a `shouldRun = next.enabled && this.desiredStarted` check:**
  mirrors the pre-085 `applyPersistedConfig` faithfully, including recomputing and publishing the
  freshly resolved `effectiveDirectory`/`projectsDirectory` even while the environment is not running
  (disabled, or the whole service is stopped) — verified by the existing, unmodified
  `stoppedActionRuntime` assertions in `claude-directory-runtime.test.mjs` (a `changeDirectory()` call
  issued after `stop()` must still publish the new root without starting anything).
- `src/shared/eyesOnAgents/claudeInventoryBridge.contract.ts`: `getClaudeInventoryBridgeEndpoint` gained
  the optional third `environmentId` parameter described above.
- `src/main/eyesOnAgents/claudeWatcher.supervisor.ts`: minimal, as anticipated — added
  `environmentId`/`environmentLabel`/`logger` to its constructor dependencies, threaded `environmentId`
  into the endpoint call, and added the one `ready`-frame log line. No other change; its CLI-arg/root-list
  plumbing already supported one process per environment without a rewrite, confirmed by reading it
  before touching it.
- `src/main/eyesOnAgents/claudePath.resolver.ts`: **not touched.** Its `resolveClaudeDirectory` already
  takes one `configDirectory` string; `claudeObservation.service.ts`'s `resolveDirectory` dependency
  callback (constructed once in `eyesOnAgents.handler.ts`) already took one `EyesOnAgentsClaudeEnvironment`
  and was already being invoked once per environment resolution call, so no signature change was needed
  anywhere in this file — confirmed before leaving it alone, per the task's own instruction.
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`: added `EyesOnAgentsClaudeEnvironmentStatus` (every
  pre-085 `EyesOnAgentsClaudeDirectoryStatus` field plus `id`/`label`/`enabled`) and redefined
  `EyesOnAgentsClaudeDirectoryStatus` as `EyesOnAgentsClaudeEnvironmentStatus[]` — literally matching
  the design doc's and this task's own "becomes `EyesOnAgentsClaudeEnvironmentStatus[]`" wording, so
  the `EyesOnAgentsSnapshot.claudeDirectory` field name and every consumer's import name stay unchanged.
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`: `STOPPED_CLAUDE_DIRECTORY_STATUS` became `[]` (an
  empty array fallback instead of one synthetic "stopped" object); the two `claudeDirectory: … ? … : …`
  snapshot-builder branches switched from object-spread (`{ ...STOPPED_CLAUDE_DIRECTORY_STATUS }`,
  which would silently turn an array into a plain object with numeric keys) to array-spread
  (`[...STOPPED_CLAUDE_DIRECTORY_STATUS]`). No other change was needed in this ~3,000-line file — every
  other `claudeObservation` dependency method call (`start`/`stop`/`refresh`/`changeDirectory`/
  `useAutomaticDirectory`/`retryDirectory`) kept its exact pre-085 signature.
- `src/main/xpc/eyesOnAgents.handler.ts`: the module-scope singleton `claudeWatcher` +
  `ClaudeObservationService({ watcher: claudeWatcher, … })` became a `createClaudeWatcher(environment)`
  factory (constructs one `ClaudeWatcherSupervisor` per call, with `onInvalidation`/`onTerminated`
  closures bound to that one `environment.id`) passed as `createWatcher`; the six environment-CRUD XPC
  methods each gained one `await claudeObservation.applyEnvironments();` call (see above).
- Test fixture (`scripts/eyes-on-agents/claude-directory-runtime.fixture.mjs`): added
  `createWatcherFactory(order)`, returning `{ factory, watchers }` — one independent tagged watcher
  mock per environment id, for the new multi-environment test. The existing `createWatcher(order)`
  export (one bare watcher mock, for every single-environment test) is untouched.
- Existing test files mechanically adapted (functional test maintenance, no assertion weakened):
  - `scripts/eyes-on-agents/claude-inventory.test.mjs`: its four `ClaudeObservationService`
    constructions changed `watcher: { … }` to `createWatcher: () => ({ … })`.
  - `scripts/eyes-on-agents/claude-directory-runtime.test.mjs` and
    `scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs`: every `watcher: <expr>` dependency
    became `createWatcher: () => <expr>`; every `runtime.handleWatcherFailure(error)` call became
    `runtime.handleWatcherFailure('env-default', error)` (both files' fixtures configure exactly one
    environment, id `'env-default'`); every `runtime.getDirectoryStatus()` singular-object access was
    replaced with a small local `status(runtime, id = 'env-default')` helper that finds that one
    environment's entry in the now-array return value (falling back to an all-null `"starting"`
    placeholder in `claude-directory-runtime.test.mjs`, matching what the pre-085 status object always
    showed before its first successful hydration) — except the two `ClaudeDirectoryConfigService`-backed
    scenarios (`recoverableRuntime`'s real migration/recovery test, and the thrown-hydrate
    `hydrationRuntime` test), which read `getDirectoryStatus()[0]` directly since those specifically
    exercise a generated-uuid or single-sentinel-array shape the id-matching helper cannot resolve.
- New test file `scripts/eyes-on-agents/claude-environment-watcher.test.mjs` covers exactly the
  Verification section's five bullets against two configured environments (`env-a` automatic, `env-b`
  custom): (1) independent lifecycles — `env-a`'s `handleWatcherFailure`/retry/recovery never changes
  `env-b`'s status object (`assert.deepEqual` snapshot before/after) or restarts its watcher process;
  (2) disabling `env-b` via `applyEnvironments()` produces `state: 'stopped'`, joins its supervisor
  (`watcher.running === false`), and never schedules a retry timer, while `env-a` is untouched, then
  re-enabling restarts only `env-b`'s watcher process; (3) removing `env-b` shrinks the status array to
  one entry and joins its supervisor, leaving `env-a` untouched; (4) `stop()` joins **both**
  environments' supervisors (a bug that would only stop the first environment discovered during
  development is exactly what this asserts against); (5) a captured `logger.info` array is scanned
  after a forced `env-a` failure/retry/recovery cycle to assert no line contains `configA`/`configB`
  (the real fixture directory paths) and no line naming `id=env-a` also names `id=env-b` or vice versa.

## Verification evidence

- `node scripts/eyes-on-agents/claude-environment-watcher.test.mjs` — passed (all five scenarios).
- `node scripts/eyes-on-agents/claude-directory-runtime.test.mjs` — passed after adaptation.
- `node scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs` — passed after adaptation.
- `node scripts/eyes-on-agents/claude-inventory.test.mjs` — passed after adaptation.
- `yarn test:eyes-on-agents:claude` (full script, now including the new file) — passed: every
  plain-`node` script printed its "tests passed" line and every `node --test` group reported 0
  failures.
- `yarn test:eyes-on-agents` (full suite: core, project-resolver, repository, app-server, bridge,
  claude, ui) — passed, 0 failures across every reporting group, exit code 0.
- `yarn typecheck:eyes-on-agents:core` (`tsc -p scripts/eyes-on-agents/tsconfig.strict.json`) — passed
  with 0 errors, both immediately after the service rewrite and again after every subsequent file
  touched in this task.
- Electron was not launched; no E2E/Playwright suite was run, per instruction.
- **Renderer typecheck regression, found by review, patched by the orchestrator before closing this
  task:** `ClaudeObservationCard.vue`'s `directory` computed read `claudeDirectory` as a single
  status object; since `claudeDirectory` is now an array, `yarn typecheck:eyes-on-agents:ui` broke
  with 13 `TS2339` errors (confirmed a genuine new regression, not pre-existing, by diffing against
  the clean pre-085 tree). Every downstream read in this file already used `directory.value?.`
  optional chaining, so the fix is one line:
  `eyesOnAgentsStore.snapshot?.claudeDirectory ?? null` →
  `eyesOnAgentsStore.snapshot?.claudeDirectory?.[0] ?? null` (line 272) — no template or downstream
  logic changed. This intentionally shows only `environments[0]`'s status until task 088 replaces it
  with the real per-environment list; it is a compile-preserving stopgap, not task 088's actual work.
  `yarn typecheck:eyes-on-agents:ui` and `yarn test:eyes-on-agents:ui` (75/75) both pass after this
  change.

## Review

[Independent review 1](../reviews/eyes-on-agents-claude-multi-env-watcher-085-1.md) initially
returned `blocked` on exactly the renderer typecheck regression above, with a precise one-line fix
recommendation; that fix is now applied (see evidence above) and re-verified. The review also traced
and confirmed both claimed bug fixes (a real cross-environment socket/named-pipe endpoint collision,
and a hydration/reconciliation race that was removed rather than shipped) directly against the diff
and call graph, not from the developer's claims alone. One non-blocking gap — no test constructs two
real environment ids and asserts their bridge endpoints differ, only that the parameter is accepted
— is recorded in `docs/plan/backlog.md`.
