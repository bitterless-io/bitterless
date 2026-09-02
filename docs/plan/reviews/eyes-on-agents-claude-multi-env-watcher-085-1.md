---
id: eyes-on-agents-claude-multi-env-watcher-085-1
status: blocked
reviewed_task: eyes-on-agents-claude-multi-env-watcher-085
target: dev-next-working-tree-2026-09-02 (uncommitted, on top of ddbe910)
date: 2026-09-02
review_type: independent-source-and-test
---

# EyesOnAgents Claude Multi-Environment Watcher Review 1

## Findings

### P1

#### 1. `yarn typecheck:eyes-on-agents:ui` regresses from green to red on this task's own diff, and stays red for two more full tasks before it is fixed — `[P1][BLOCKING]`

- **Verified independently, not taken on the developer's word.** Ran `yarn typecheck:eyes-on-agents:ui`
  on the current dirty tree: **exit code 2**, 13 `TS2339` errors, all in
  `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue`
  (lines 71, 73, 74, 381, 382, 384, 388, 400, 404, 408, 412, 415 — every property read off the new
  `EyesOnAgentsClaudeEnvironmentStatus[]` array as if it were still the singular status object).
  `git stash` to the clean `ddbe910` tree and re-ran the identical command: **exit code 0**, "Done in
  1.17s." `git stash pop` restored the developer's work intact (confirmed via `git status` — same 13
  files modified, 1 untracked, nothing lost). This is a genuine **new** regression introduced by this
  task's diff, not a pre-existing failure — the bisection methodology matches the one task 082's
  review evidence used for `check:renderer-i18n`.
- **The developer's technical explanation is accurate.** `scripts/eyes-on-agents/tsconfig.strict.json`
  (`typecheck:eyes-on-agents:core`'s project file) really does have no renderer path in its `include`
  list — confirmed by reading the file directly. That is why `typecheck:eyes-on-agents:core` (the
  task's own required verification command) stayed green throughout while
  `typecheck:eyes-on-agents:ui` (a different script, not listed in this task's `verify:` frontmatter
  or Verification section) broke.
- **The "task 088 fixes it immediately" framing in the task file is not accurate.** Task 088
  (`docs/plan/tasks/eyes-on-agents-claude-multi-env-renderer-088.md:5`) declares
  `depends-on: [eyes-on-agents-claude-multi-env-data-model-084, eyes-on-agents-claude-multi-env-watcher-085, eyes-on-agents-claude-multi-env-plugin-install-086, eyes-on-agents-claude-multi-env-hook-attribution-087]`.
  Tasks 086 (plugin install) and 087 (hook attribution) are both `status: pending` and both sit
  between 085 and 088 in the serial chain; neither touches `ClaudeObservationCard.vue` per their own
  scope. That means this typecheck break is not a "short-lived intermediate state" — it will persist
  on `dev/next` through two more full task cycles before 088 even starts, let alone lands.
- **Established project practice treats this exact check as a required cross-task gate, not an
  optional extra.** Task 082's own Verification evidence
  (`docs/plan/tasks/eyes-on-agents-iterm2-backend-082.md:170-171`) ran `yarn typecheck:eyes-on-agents:ui`
  specifically "confirming the renderer was not touched and still compiles" even though 082 never
  touched the renderer — i.e. this project already uses this exact command as a cheap cross-task
  confidence signal, the same way it uses `git stash` bisection to separate new regressions from
  pre-existing ones (the `check:renderer-i18n` precedent). Task 083 requires it outright in its
  Verification section. A task closing with this signal newly red — for a reason as mundane as one
  file reading an array as an object — breaks that signal for every task in between, and makes a
  future unrelated regression on this same command indistinguishable from this already-known one
  until someone re-derives this exact investigation.
- **The fix is genuinely one line and does not require task 088's redesign.** Confirmed by reading
  `ClaudeObservationCard.vue`: every downstream read of `directory.value` (lines 381-415) already
  uses optional chaining (`directory.value?.effectiveDirectory`, `?.mode`, `?.state`, etc.), so the
  only change needed is at
  `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue:272`:
  ```ts
  const directory = computed(() => eyesOnAgentsStore.snapshot?.claudeDirectory ?? null);
  ```
  → `eyesOnAgentsStore.snapshot?.claudeDirectory?.[0] ?? null`. This restores single-environment
  compile-and-render correctness (first configured environment shown, matching today's real-world
  single-environment behavior for every existing user) without building any of task 088's actual
  list UI.
- **Recommendation: (b), not (a).** Require the one-line `claudeDirectory?.[0]` patch (or equivalent)
  in `ClaudeObservationCard.vue` before closing this task, re-run `yarn typecheck:eyes-on-agents:ui`
  to confirm exit 0, and record it in this task's own Implementation evidence as a compile-preserving
  stopgap explicitly superseded by task 088's real redesign. This is not a request to build any part
  of 088's list UI now — only to keep the branch's own established typecheck gate green between task
  boundaries, consistent with 082/083's practice and this project's `git stash`-bisection discipline
  for telling a real regression apart from noise.

### P2

#### 2. Socket/pipe collision fix has no test that proves two environments actually get distinct, non-colliding endpoints — `[P2][non-blocking]`

- **The bug and the fix are both real, confirmed by direct diff inspection, not by the developer's
  narrative alone.** Before this task, `getClaudeInventoryBridgeEndpoint(userDataPath)`
  (`src/shared/eyesOnAgents/claudeInventoryBridge.contract.ts`, pre-085 at `HEAD`/`ddbe910`) derived
  the Unix socket path as `join(userDataPath, 'eyes-on-agents', 'claude-inventory.sock')` and the
  Windows named-pipe suffix as `sha1(userDataPath)` — both constant across every environment, so two
  simultaneously-running `ClaudeWatcherSupervisor` instances (one per environment, which this task
  genuinely introduces) would have raced to bind/connect the identical socket/pipe. The fix
  (`src/shared/eyesOnAgents/claudeInventoryBridge.contract.ts:36-49`) adds an optional third
  `environmentId` parameter folded into both the Unix path (`claude-inventory${scope}.sock`) and the
  Windows hash input (`sha1(userDataPath + scope)`), where `scope` is empty only when `environmentId`
  is `undefined`.
- **Backward compatibility confirmed by exhaustive caller search, not assumption.**
  `grep -rn "getClaudeInventoryBridgeEndpoint"` across the entire repository returns exactly three
  hits: the definition, the one production call site
  (`src/main/eyesOnAgents/claudeWatcher.supervisor.ts:110-114`, which now always passes
  `this.dependencies.environmentId` — always defined in production via
  `src/main/xpc/eyesOnAgents.handler.ts`'s `createClaudeWatcher(environment)` factory, which sets
  `environmentId: environment.id`), and one test call
  (`scripts/eyes-on-agents/claude-inventory.test.mjs:313`, which passes only 2 args, reproducing the
  exact pre-085 path). No other caller anywhere depends on the old fixed path.
- **Gap: nothing exercises two distinct `environmentId`s producing two distinct paths.** The new
  `scripts/eyes-on-agents/claude-environment-watcher.test.mjs` (and every scenario in it) drives
  `ClaudeObservationService` through `createWatcherFactory` in
  `scripts/eyes-on-agents/claude-directory-runtime.fixture.mjs:123-152`, which is a pure mock — it
  never constructs a real `ClaudeWatcherSupervisor` and never calls
  `getClaudeInventoryBridgeEndpoint`. Grepping every `.test.mjs` under `scripts/eyes-on-agents/` for
  `environmentId` finds it only in that one fixture mock, never in an assertion. The pre-existing
  `ClaudeWatcherSupervisor`-level tests
  (`scripts/eyes-on-agents/claude-inventory.test.mjs:557`,
  `scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs:385,430`) were not extended to
  construct two supervisors with different `environmentId`s and assert their resolved endpoint paths
  differ. The fix is correct by code inspection (the hash/path genuinely differs whenever
  `environmentId` differs), but the specific guarantee this task's own Implementation evidence claims
  to fix — "two simultaneously-running environments would never both work" — has no regression test
  standing behind it; a future refactor of `getClaudeInventoryBridgeEndpoint` or the factory wiring
  could silently reintroduce the collision with every existing test still green.
- **Recommendation:** non-blocking for this task's closure (the fix itself is sound and the
  Verification section's own bullets — which this addresses as a bonus fix, not a named requirement —
  are otherwise met), but record a `docs/plan/backlog.md` entry (matching the existing "Task N
  review: ..." convention) asking for a direct unit assertion, e.g.
  `getClaudeInventoryBridgeEndpoint(dataPath, 'darwin', 'env-a').path !== getClaudeInventoryBridgeEndpoint(dataPath, 'darwin', 'env-b').path`,
  or two real `ClaudeWatcherSupervisor` instances with different `environmentId`s asserted to bind
  distinct endpoints.

### P3

#### 3. Task 088's own task file does not yet warn that `ClaudeObservationCard.vue` will already be broken when it starts — `[P3][non-blocking]`

- `docs/plan/tasks/eyes-on-agents-claude-multi-env-renderer-088.md` was written before this task ran
  (as part of task 084's commit) and its Context/Required-behavior sections say nothing about
  inheriting an already-red `typecheck:eyes-on-agents:ui`. The warning currently exists only inside
  task 085's own Implementation evidence, which a future session picking up 088 has no structural
  reason to re-read. If finding 1 above is resolved with the one-line patch, this note becomes moot;
  if the break is instead left in place for 088 to pick up, task 088's file should gain one sentence
  under Context pointing at exactly this state, mirroring how the design doc's implementation notes
  cross-reference specific later task numbers today.

## Verified as correct (no finding)

These are the specific claims the review brief asked to be checked independently; recorded here
because the check was substantive, not to pad the findings list.

- **Independent per-environment generation fence, supervisor instance, and retry ladder.** Traced in
  `src/main/eyesOnAgents/claudeObservation.service.ts`: `ClaudeEnvironmentObservationState`
  (lines 65-80) owns its own `generation`, `retryTimer`, `retryAttempt`, and `watcher` per map entry;
  `scheduleEnvironmentRetry`/`cancelEnvironmentRetry` (lines 752-778) and
  `handleWatcherFailure`/`recoverEnvironment` (lines 251-266, 658-686) operate only on the one `state`
  object passed in, with no shared/global timer or counter anywhere in the file. The new
  `claude-environment-watcher.test.mjs` scenario 1 exercises this directly (forcing `env-a`'s failure
  and asserting `env-b`'s status is `deepEqual` before/after); `node --test` on that file passed.
- **A disabled environment reports `state: "stopped"` with no running supervisor and never enters the
  retry ladder.** Traced `applyEnvironmentConfigBody` (lines 531-582): when `next.enabled` is
  `false`, `shouldRun` (line 544) is `false`, so the `!rootChanged` branch calls
  `stopEnvironmentBody` → `stopEnvironmentBodyAfterFence` (lines 502-525), which bumps `generation`,
  cancels any retry timer, and sets `state: 'stopped'`, `watching: false`, `nextRetryAt: null` — with
  `state.started` now `false`, every retry-scheduling path is gated behind `isEnvironmentCurrent`
  (line 828: `state.started && state.generation === generation`), so no in-flight or future retry can
  fire for a disabled environment. `claude-environment-watcher.test.mjs` scenario 2 asserts this
  end-to-end (`state.started` disabled via `applyEnvironments()`, `timers.active().length === 0`).
- **Every call site that stopped/started/queried "the" watcher now iterates every environment.**
  Grepped every caller of `claudeObservation.{start,stop,refresh,changeDirectory,useAutomaticDirectory,retryDirectory,applyEnvironments,invalidate,handleWatcherFailure,getDirectoryStatus,requireCanonicalTranscript}`
  across `src/`. All shutdown/logout/provider-disable call sites in
  `src/main/eyesOnAgents/eyesOnAgents.service.ts` (lines 787, 2566, 2573, 2578, 2643, 2772) call the
  whole-service `start()`/`stop()`, which internally iterate `this.environments.values()` (confirmed
  in `claudeObservation.service.ts:165-194`) — no external call site needs its own per-environment
  loop because the fan-out is encapsulated in the service. The six environment-CRUD XPC methods in
  `src/main/xpc/eyesOnAgents.handler.ts` (lines 430, 439, 445, 456, 464, 472) each call the new
  `claudeObservation.applyEnvironments()` once after persisting their mutation.
- **`EyesOnAgentsClaudeEnvironmentStatus` field completeness.** `src/shared/eyesOnAgents/eyesOnAgents.type.ts:191-209`
  carries every field the design doc's Watcher section lists (`mode`, `configuredDirectory`,
  `effectiveDirectory`, `projectsDirectory`, `desktopDirectoryCount`, `state`, `watching`,
  `lastScanAt`, `lastSuccessfulScanAt`, `nextRetryAt`, `error`) plus `id`, `label`, `enabled`.
- **Logging never carries `configDirectory`, and does carry `id`/`label`.** The only two new log call
  sites in this diff are `claudeObservation.service.ts:834-844` (`logEnvironmentLifecycle`, scoped
  `[claude-watcher] action=<start|retry|fatal> id=... label="..."`) and
  `claudeWatcher.supervisor.ts:252-258` (`logLifecycle`, same scope, `ready` only, gated on
  `environmentId !== undefined` so bare pre-085-style test construction emits nothing). Neither
  passes `configDirectory`, `effectiveDirectory`, or any other path value as an argument — confirmed
  by reading both call sites directly, and by `claude-environment-watcher.test.mjs` scenario 5, which
  captures every `logger.info` call during a forced failure/retry/recovery cycle and asserts none
  contains the fixture's real directory paths and no line names two environment ids at once. Actual
  captured log output from a real run (see Verification below) confirms this in practice, not just in
  the mock.
- **Race condition removal (bug 2) — traced independently since nothing in the current diff
  "proves" a removed code path.** `refreshEnvironment` (`claudeObservation.service.ts:691-722`)
  opens with `if (!state.started || state.capabilityClearPending) return { changed: false };` — a
  not-yet-started environment is never eagerly started here. The only "not started → start" fallback
  left anywhere is the whole-service `refresh()` (lines 270-279): `if (!this.started) { if
  (!this.desiredStarted) return {changed:false}; await this.start(); return {changed:false}; }` —
  this calls the full `start()` method, which is itself routed through `runServiceLifecycle` (line
  150). Every mutating entry point that can populate or restart the environment map —
  `start()` (150), `stop()` (178), `changeDirectory()`/`useAutomaticDirectory()`/`retryDirectory()`
  (204, 214, 221), and `applyEnvironments()` (240) — is wrapped in `runServiceLifecycle`
  (lines 808-812), which chains strictly on one `serviceLifecycleTail` promise. Because of that single
  chain, a CRUD-triggered `applyEnvironments()` firing while a `start()`'s hydration is still
  in-flight cannot interleave with it — it is queued behind the in-flight operation and only runs once
  `hydrateAndReconcile()` has fully settled the map, so it can never read stale, pre-hydration config.
  This exactly closes the race the developer describes as removed.

## Standard checks

- **Out-of-scope touches:** `git diff HEAD --stat` shows only the 13 files this task's own Path
  entries and its own Implementation-evidence-declared exceptions predict (shared type, contract,
  supervisor, service, handler, docs, tests, `package.json`'s script wiring). No plugin/hook install
  file, no Hook payload schema file, and no renderer `.vue`/`.ts` file appears in the diff — the
  renderer break in finding 1 is an omission (a file that needed a change wasn't changed), not an
  out-of-scope edit.
- **Test file quality.** `claude-environment-watcher.test.mjs`'s five scenarios are not tautological:
  each asserts on the real `ClaudeObservationService` (not a re-implementation), uses `deepEqual`
  snapshots of a sibling environment's full status object before/after a fault injection (scenario 1),
  asserts concrete process-start counters via the per-environment watcher mocks (scenarios 2-4), and
  scans real captured logger output for cross-contamination (scenario 5). The three mechanically
  adapted files (`claude-directory-runtime.test.mjs`, `claude-directory-runtime-race.test.mjs`,
  `claude-inventory.test.mjs`) were diffed line-by-line against `HEAD`; every assertion value/message
  is unchanged, only the `watcher: X` → `createWatcher: () => X` dependency shape and
  `getDirectoryStatus()` → `status(runtime)`/`getDirectoryStatus()[0]` access pattern changed. No
  assertion was weakened, loosened, or removed.
- **Code style.** No `forEach` and no `function` declarations were introduced anywhere in the diff
  (grep confirmed); new standalone logic stays in arrow-const/class-method form matching this file's
  existing style; new comments are dense but consistent with this file's existing block-comment
  density. `git diff --check` is clean (no whitespace errors).

## Verification (re-run independently; developer's claimed results were not taken at face value)

| Command | Result |
| --- | --- |
| `node --test scripts/eyes-on-agents/claude-environment-watcher.test.mjs` | exit 0, 1/1 test passed |
| `node scripts/eyes-on-agents/claude-directory-runtime.test.mjs` | exit 0, passed |
| `node scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs` | exit 0, passed |
| `node scripts/eyes-on-agents/claude-inventory.test.mjs` | exit 0, passed |
| `yarn test:eyes-on-agents:claude` | exit 0, 29/29 `node --test` passed, all plain-`node` scripts printed their pass line |
| `yarn test:eyes-on-agents` (full) | exit 0, 75/75 in the `:ui` `node --test` group, 0 failures across every group |
| `yarn typecheck:eyes-on-agents:core` | exit 0, "Done in 0.89s." |
| `yarn typecheck:eyes-on-agents:ui` (dirty tree) | **exit 2**, 13 `TS2339` errors in `ClaudeObservationCard.vue` |
| `yarn typecheck:eyes-on-agents:ui` (`git stash` → clean `ddbe910`) | exit 0, "Done in 1.17s." — confirms the failure above is a new regression, not pre-existing |
| `git stash pop` | restored the developer's 13 modified files + 1 untracked file intact |

Electron was not launched; no E2E/Playwright suite was run, matching the task's instruction.

## Conclusion

`blocked`

Blocking reason: finding 1 (`yarn typecheck:eyes-on-agents:ui` newly broken by this task's own diff,
and not actually fixed until two further tasks land). Everything else — the multi-environment
watcher/retry/status rewrite itself, the socket/pipe collision fix, the race-condition removal, every
call-site audit, and every re-run test/typecheck command this review is asked to perform — is
independently confirmed correct and matches the task file's Required behavior and the current design
doc text. Once `ClaudeObservationCard.vue` is patched to read `claudeDirectory?.[0]` (or equivalent)
and `yarn typecheck:eyes-on-agents:ui` is confirmed green, this task has no other blocking finding.
