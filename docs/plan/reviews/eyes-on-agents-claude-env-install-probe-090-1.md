# Review 1 — eyes-on-agents-claude-env-install-probe-090

Reviewer: independent review pass (no source edits, no commit, no push, no branch operation; no
Electron / packaged build / Playwright / `test:e2e:*` run; the real `claude` CLI was never invoked
and no real `~/.claude` or `~/.claude2` was read or written).

**Verdict: `blocked`** — 2 blocking findings, 9 non-blocking (P3) findings, and 12 corrections to
the task's own Implementation-evidence text.

The core of the task is genuinely well built. The verdict mapping is exact and every branch of it is
pinned by a test that I confirmed fails when I break the branch. `this.inspection` really is
untouched. The coalescing map really does coalesce, does not leak, does not lose a rejection, and —
verified empirically, not by reading — the coalesced second caller *does* observe the fresh verdict
when it returns. What is wrong is at the seams: the renderer collapse removed the only UI path to
repair a **non-default** environment, and the probe was wired *synchronously into the observation
service's lifecycle queue*, so a read-only status readout now gates app shutdown, environment CRUD,
and Claude thread projection on `claude` child processes.

## Review method

Reviewed commit `1041f9b` via `git show 1041f9b`. Confirmed the commit is the one under review and
`HEAD` on `dev/next`. The working tree carries unrelated concurrent OnlyPreview work
(`src/main/onlypreview/**`, `src/renderer/onlypreview/**`, `src/shared/onlypreview/onlyPreview.types.ts`,
`tests/onlypreview/**`, `docs/features/onlypreview-alert-dialogs.md`,
`docs/plan/tasks/onlypreview-alert-dialogs-120.md`, `docs/issues/eyes-on-agents-omni-search-shortcut-focus.md`,
`docs/INDEX.md`) — ignored, not touched, not staged, not reverted. `git status --porcelain` at the
end of the review is byte-identical to its state at the start.

Where a claim was checkable by breaking the code, I broke it — in a **scratch copy** at
`$SCRATCHPAD/mut` (a `cp -R` of `src/`, `scripts/`, `tsconfig*.json` with `node_modules` symlinked
back to the repo), never in the repo. 15 mutations were applied and reverted; the scratch tree was
deleted afterwards. Results are in "Mutation testing" below.

Files changed by the commit:

```
docs/integrations/eyes-on-agents-layout.md
docs/plan/tasks/eyes-on-agents-claude-env-install-probe-090.md
package.json
scripts/eyes-on-agents/claude-environment-install-probe.test.mjs   (new)
scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs
scripts/eyes-on-agents/claude-environment-render.test.mjs
src/main/eyesOnAgents/claudeObservation.service.ts
src/main/eyesOnAgents/claudePluginBridge.service.ts
src/main/eyesOnAgents/eyesOnAgents.service.ts
src/main/xpc/eyesOnAgents.handler.ts
src/renderer/common/i18n/en.ts
src/renderer/common/i18n/zh.ts
src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue
src/shared/eyesOnAgents/eyesOnAgents.type.ts
```

Three files sit outside the task's declared **Path**: `src/main/eyesOnAgents/eyesOnAgents.service.ts`
(the explicit install/refresh/remove triggers), `src/main/xpc/eyesOnAgents.handler.ts` (composition
root), `package.json` (test wiring). All three are forced by the contract's own trigger and
snapshot requirements and each edit is minimal. The Path was simply not updated to list them (P3-9).

## Verification I ran

```
$ yarn typecheck:eyes-on-agents:core
$ tsc -p scripts/eyes-on-agents/tsconfig.strict.json
Done in 3.39s.                                        # 0 errors

$ yarn typecheck:eyes-on-agents:ui
$ vue-tsc --noEmit -p scripts/eyes-on-agents/tsconfig.ui.json --composite false
Done in 2.42s.                                        # 0 errors

$ yarn test:eyes-on-agents:claude                     # EXIT=0
ℹ fail 0    (group 1, tests 27)
ℹ fail 0    (group 2, tests 17)
ℹ fail 0    (group 3, tests 1)
ℹ fail 0    (group 4, tests 43)
# every standalone script passed, including
#   "EyesOnAgents Claude environment install-probe tests passed"
#   "EyesOnAgents Claude environment plugin install tests passed"

$ yarn test:eyes-on-agents:ui                         # EXIT=1
ℹ tests 104
ℹ pass 102
ℹ fail 2
✖ right-click opens the shared pointer menu and Archive remains Codex-only
    scripts/eyes-on-agents/thread-card-open-capability.test.mjs:475:9 — assert.ok(dropdown)
✖ completed threads use one localized silent notification and bundled cross-platform tone
    scripts/eyes-on-agents/ui-source.test.mjs:30:1 — setAppUserModelId bundle-id regex
```

Both UI failures are the two already-logged pre-existing ones (`docs/plan/backlog.md`, entries for
merge commit `34ba84a` and for the flaky right-click test). **No third failure.** The right-click
flake did fire on my run; the task's evidence says it did not fire on theirs — both statements can
be true of a ~6/10 flake, and the backlog already records it as flaky rather than deterministic.

ESLint, per touched source file (errors only; every file in this repo carries large numbers of
pre-existing `prettier/prettier` **warnings**, which are not gated):

| file | errors |
|---|---|
| `src/main/eyesOnAgents/claudePluginBridge.service.ts` | 0 |
| `src/main/eyesOnAgents/claudeObservation.service.ts` | 0 |
| `src/main/eyesOnAgents/eyesOnAgents.service.ts` | 1 — `1309:5 'operation' is never reassigned` (`prefer-const`) |
| `src/main/xpc/eyesOnAgents.handler.ts` | 2 — `93:5 'eyesOnAgentsService'`, `94:5 'claudeObservation'` (`prefer-const`) |
| `src/renderer/common/i18n/en.ts` | 0 |
| `src/renderer/common/i18n/zh.ts` | 0 |
| `.../ConnectionPanel/ClaudeObservationCard.vue` | 0 |
| `src/shared/eyesOnAgents/eyesOnAgents.type.ts` | 0 |

Exactly the three expected pre-existing `prefer-const` errors at the expected lines. **"0 new
eslint errors" CONFIRMED.**

## Blocking findings

### B1 — the renderer collapse removed the only path to Install/Repair a **non-default** environment

`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue:162-189`

Pre-090, every environment row rendered the profile-wide setup action **scoped to that row**:
`v-if="['enable', 'finish', 'repair'].includes(setupAction)"` → `handleInstallForEnvironment(environment.id)`.
Post-090 the row offers `handleInstallForEnvironment` only when `environment.pluginPresence` is
`'not_installed'` or `'disabled'` (`:170-171`). When a row's presence is `'installed'` the row
offers **no action at all**.

But `pluginPresence: 'installed'` means only *present and enabled for that directory* — the probe
deliberately ignores drift, artifact digest, marketplace exactness and version
(`claudePluginBridge.service.ts:441-460`; contract line 43 requires exactly this). So a plugin that
is present, enabled, **and stale/drifted** reports `'installed'`.

Meanwhile `getStatus()`'s `setupAction` becomes `'repair'` in exactly that state
(`claudePluginBridge.service.ts:387-395`, via `exactInstalled === false` from
`state.artifactDigest !== digest` at `:523-525`). The only remaining Repair button is card-level
(`ClaudeObservationCard.vue:326-334` → `handleInstall` → `eyesOnAgentsStore.installClaudeBridge()`
at `store/eyesOnAgents.store.ts:344`), and that call passes **no** `environmentId`, so
`resolveClaudeBridgeConfigDirectory(undefined)` →
`resolveClaudeBridgeEnvironment(environments, undefined)` → `environments[0]`
(`eyesOnAgents.service.ts`, `resolveClaudeBridgeEnvironment`). Plugin installation is per
`CLAUDE_CONFIG_DIR` (`performInstall(configDirectory)` threads it into every `this.command(...)`,
`claudePluginBridge.service.ts:692-713`).

**Failure scenario.** Two environments: `Default` (`~/.claude`, `environments[0]`) and `claude2`
(`~/.claude2`). The user updates Bitterless, so the expected artifact digest changes and the profile
goes `drifted` / `setupAction: 'repair'`. Both directories still have the plugin listed as
installed+enabled, so both rows probe `'installed'`.
→ `claude2`'s row shows the pill **"Plugin installed"** and no button.
→ The card-level **Repair** repairs `~/.claude` only.
→ There is now **no UI path to repair `~/.claude2`'s plugin.** `claude2` keeps running the stale
plugin indefinitely, while its row cheerfully claims the plugin is installed.

Pre-090 this was reachable in one click from `claude2`'s row. The task-088 P3 this task set out to
close (`docs/plan/backlog.md`, "Task 088 review: the plugin setup-action block renders once per
environment row…") explicitly recommended *"Collapse the repeated block into one card-level surface
**with a per-environment target selector**, or drop the standalone section."* The implementation
dropped the repeated block and did **not** add the target selector, and did not drop the standalone
section — which is precisely how the reachability was lost.

Not fixed here: the smallest correct fix is a design choice (re-offer the row-scoped action when the
card-level `setupAction` is `enable`/`finish`/`repair` even for an `'installed'` row, which partly
re-introduces what the task was asked to remove; or give the card-level setup section an
environment target selector). It also needs a label decision — the existing `installPlugin` string
is wrong for a repair. Reporting rather than patching.

### B2 — the read-only probe was wired into the observation service's lifecycle queue, so app shutdown, environment CRUD and Claude thread projection now wait on `claude` child processes

`src/main/eyesOnAgents/claudeObservation.service.ts:499`

`reconcileEnvironments()` ends with `await this.probeEnvironmentPresence(staleIds);`. That call sits
inside the service lifecycle queue: `start()` → `runServiceLifecycle(...)` → `hydrateAndReconcile()`
(`:255`, `:436`) → `reconcileEnvironments()` → probe. Same for `applyEnvironments()` (`:337-341`)
and `retryDirectory()` on an invalid hydration (`:322`).

Each probe is `ClaudePluginBridgeService.probePluginPresence()`, which calls `resolveExecutable()`
(up to two `claude … --help` spawns per candidate, `timeoutMs: 30_000` each,
`claudePluginBridge.service.ts:1494-1506`) plus two `claude plugin … --json` spawns
(`:1386-1389`, `timeoutMs: 30_000` via `command()` at `:1527-1531`). At app start the probe is the
**first** bridge CLI consumer — `activateClaudeProvider` awaits `claudeObservation.start()`
(`eyesOnAgents.service.ts:2652`) *before* it touches `this.dependencies.claudeBridge` — so
`this.executable` is cold and `resolveExecutable()` runs; it has **no coalescing**, so N
environments probing concurrently each run their own candidate scan. Cold cost: **4 `claude`
process spawns per environment**, ~3 CLI round-trips of wall-clock latency.

I verified the blocking empirically (scratch copy, stubbed probe that never resolves):

```
G: start() -> start-HUNG
G: getDirectoryStatus during hang -> env-a:watching:unknown env-b:watching:unknown
G: stop()  -> stop-HUNG
```

Status readout is *not* blocked (`getDirectoryStatus()` stays synchronous and cache-only), and
sibling probes do run concurrently — so the contract's literal concurrency clause holds. What is
blocked is the lifecycle:

**Failure scenario A (shutdown).** `EyesOnAgentsService.shutdown()` awaits
`claudeObservation.stop()` (`eyesOnAgents.service.ts:825`). `stop()` fences synchronously but then
queues behind the in-flight reconcile probe. With a `claude` binary that is slow or wedged (its
`--help` path is not free), app quit waits up to the 30 s command timeout — per candidate for the
executable scan. Nothing is lost, but the app appears hung on quit.

**Failure scenario B (CRUD round-trip).** `addClaudeEnvironment` /
`chooseClaudeEnvironmentDirectory` / `useAutomaticClaudeEnvironment` all `await
claudeObservation.applyEnvironments()` (`eyesOnAgents.handler.ts:519-561`) before the XPC call
returns. Adding an environment now blocks the renderer round-trip on 2–4 `claude` spawns where
pre-090 it returned as soon as the watcher started. **"Add environment" spins for seconds — up to
30 s on a wedged CLI.**

**Failure scenario C (startup projection).** `claudeProviderProjectionEnabled = true` is set only
*after* `start()` resolves (`eyesOnAgents.service.ts:2666`), and `getSnapshot()` filters out every
Claude thread while it is false (`:947-951`). So on **every** app start, Claude threads stay hidden
for the extra duration of the probes.

This is the same class of coupling the evidence claims to have fixed ("a read-only status lookup
breaking observation"): the author contained the *rejection* but not the *latency*. The fix is
small and the machinery already exists — `probeEnvironmentPresence` broadcasts on completion
(`:194`), so nothing needs the reconcile path to await it. Making line 499
`void this.probeEnvironmentPresence(staleIds).catch(() => undefined);` — leaving the explicit
install/refresh/remove trigger sites awaiting, since those are already CLI-spending user actions —
restores pre-090 lifecycle latency and still lands the verdict via the existing broadcast. It is
*not* a pure one-liner (test scenario 1 asserts the verdict immediately after `await start()` and
would need to settle the probe), so I did not apply it.

## Non-blocking (P3) findings

Each phrased for direct paste into `docs/plan/backlog.md`.

- Task 090 review: `ClaudeObservationService`'s two `this.pluginPresence.delete(...)` calls
  (`src/main/eyesOnAgents/claudeObservation.service.ts:473` on environment removal, `:485` on a
  config-directory change) are **not covered by any test**. Deleting either line leaves
  `scripts/eyes-on-agents/claude-environment-install-probe.test.mjs` fully green (verified by
  mutation), because scenarios 6 and 7 both `await applyEnvironments()`, which awaits the re-probe
  that overwrites the stale verdict anyway. The delete at `:485` *is* load-bearing in the one case
  the suite does not exercise: a directory change whose re-probe then **fails** leaves the cache
  untouched, so without the delete the row would keep displaying a verdict probed against the old
  directory instead of falling back to `unknown`. Add that scenario (change directory → probe
  rejects → assert `pluginPresence === 'unknown'` and `pluginProbedAt === null`).
- Task 090 review: `presenceClass()`
  (`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue:538-545`) is
  unasserted — the render tests match only pill **text**, never the pill class. Deleting the
  `not_installed → eyes-connection-card__status--stopped` case leaves all 17 tests in
  `claude-environment-render.test.mjs` green (verified by mutation), so the presence pill's
  installed/needs_review/stopped colour mapping can regress silently. Assert `classList` on the
  `eyesOnAgents__connections__claudeEnvironmentPlugin` pill for at least the `installed` and
  `not_installed` rows.
- Task 090 review: `refreshPluginPresence` is called *after* `runClaudeBridgeLifecycle(...)` in
  `installClaudePlugin` / `refreshClaudeBridgeStatus` / `removeClaudeBridge`
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:2923`, `:2983`, `:3003`), not in a `finally`. A
  **partially** failed install — the plugin installs but the hook listener fails to start, so the
  lifecycle body rethrows (`:2913`) — skips the re-probe entirely, leaving the row's pill at its
  pre-install verdict. The user sees "Plugin not installed" plus an Install button for a plugin that
  is now installed. Move the re-probe into a `finally`.
- Task 090 review: the card-level Repair / Enable / Finish / Retry-listener buttons call
  `installClaudeBridge()` / `refreshClaudeBridgeStatus()` with no `environmentId`
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:344`, `:350`), which reaches
  `refreshPluginPresence(undefined)` and therefore probes **every** configured environment —
  2 `claude` CLI calls per environment per click. The contract's trigger list is "an explicit
  install/refresh/retry action on **that row**"; probing all rows for a card-level action is
  defensible but undocumented and uncosted. Either scope it to `environments[0]` (the directory the
  card-level action actually targets) or document the fan-out in
  `docs/features/eyes-on-agents-claude-multi-environment.md`.
- Task 090 review: `resolveExecutable()`
  (`src/main/eyesOnAgents/claudePluginBridge.service.ts:1490-1518`) is a plain check-then-set with
  no in-flight coalescing, so N environments probing concurrently at app start each run their own
  candidate scan (up to two 30 s `claude … --help` spawns per candidate). The per-environment probe
  coalescing added by task 090 does not help, because it is keyed per environment id while the
  executable resolution is profile-wide. Coalesce `resolveExecutable()` onto a single in-flight
  promise.
- Task 090 review: the `unknown` row's **Check plugin** button
  (`ClaudeObservationCard.vue:181-189` → `handleRefreshForEnvironment` →
  `refreshClaudeBridgeStatus({ environmentId })`) is not read-only, despite the label and the
  task's stated rationale ("*we could not find out* must not invite a reinstall"). It reaches
  `ClaudePluginBridgeService.refresh(configDirectory)`
  (`claudePluginBridge.service.ts:417-433`), which (a) overwrites the **profile-wide**
  `this.inspection` with an inspection of *that row's* directory via `inspectCurrent(configDirectory)`
  (`:473-538`), so the card-level global status/`setupAction` starts describing a secondary
  environment, and (b) can perform a `performTrustedAutomaticUpgrade` — a real marketplace/plugin
  mutation (`:420-428`, `:561-586`). The handler predates task 090, but 090 made it reachable from
  the **default** state (`unknown` is what every never-probed and every failed-probe row shows).
  Either point Check at a genuinely read-only re-probe (`refreshPluginPresence` alone) or rename it.
- Task 090 review: the two new row buttons use the **global** `eyesOnAgentsStore.busyAction`
  for `:loading` and `:disabled` (`ClaudeObservationCard.vue:174-176`, `:184-186`), so clicking
  Install on one row spins the Install button on every other `not_installed` row and disables every
  row's Check. Harmless pre-090 (all rows rendered the same button); newly misleading now that rows
  genuinely differ. `busyClaudeEnvironmentIds` already exists for exactly this
  (used by Retry/Remove at `:147-148`, `:205-207`) — use it, or accept that only one bridge
  mutation can be in flight and grey the others explicitly.
- Task 090 review: the new `EyesOnAgentsClaudePluginPresence` type was spliced **into the middle of
  an existing comment block** in `src/shared/eyesOnAgents/eyesOnAgents.type.ts`. Lines 190-191 now
  read "One configured Claude environment's watcher status (task 085: … moved to a per-environment
  array — see" and the sentence's completion, "EyesOnAgentsClaudeDirectoryStatus below). id/label/enabled
  mirror the environment…", is stranded at `:203-204` on the far side of the new type. Move the new
  type above `:190` so the task-085 doc comment reads as one block again.
- Task 090 review: the task doc's **Path** section
  (`docs/plan/tasks/eyes-on-agents-claude-env-install-probe-090.md:78-92`) never listed
  `src/main/eyesOnAgents/eyesOnAgents.service.ts`, `src/main/xpc/eyesOnAgents.handler.ts` or
  `package.json`, all three of which the task had to edit (trigger sites, composition root, test
  wiring). The edits are justified and disclosed in the evidence; the Path was simply not updated.
  Also `docs/features/eyes-on-agents-claude-multi-environment.md:511` still lists the triggers as
  "install/refresh/retry" while the code also probes on **plugin removal**
  (`eyesOnAgents.service.ts:3003`), and `:501-502` cites `claudePluginBridge.service.ts:1354` for
  `inspectClaudeNamespace`, which this commit shifted to `:1382`.

## What I confirmed, per the review's priority checks

**1. `this.inspection` refactor avoided — CONFIRMED, and the purity claim is accurate as scoped.**
`git show 1041f9b -- src/main/eyesOnAgents/claudePluginBridge.service.ts` is **28 insertions, 0
deletions**: one `import type` line and one new method. No existing read site of `this.inspection`
was touched, and it remains one global slot (52 references, all pre-existing). `inspectClaudeNamespace`
(`:1382-1394`) is pure with respect to `this.inspection`: it only awaits two `this.command(...)`
calls and returns `parseJsonArray` results. **Transitively it is not fully pure**, and the evidence
is right to flag it: `command()`'s catch clears `this.executable` (`:1533`), and `resolveExecutable()`
*writes* `this.executable` on success (`:1509`). Neither is installation state. I mutation-verified
the containment: making `probePluginPresence` also call `inspectCurrent(configDirectory)` fails
`claude-environment-plugin-install.test.mjs` ("a probe is exactly one plugin list + one marketplace
list"), so the "no `inspectCurrent`" property is genuinely pinned.

**2. The `this.executable` caveat — CONFIRMED, and it is *narrower* than the evidence states, not
worse.** Traced: `command()` clears `this.executable` only in the `runCommand`-**throws** branch
(`:1532-1535`) — spawn failure, timeout, or output-size kill. A **non-zero exit code** takes the
separate `:1536-1538` branch and does **not** clear it. Since a bad `configDirectory` cannot cause
a spawn failure (spawn resolves the *executable*, and `runClaudeCommand` only injects
`CLAUDE_CONFIG_DIR` into `env`, `claudeCommand.runner.ts:22-30`), the realistic failure for a
probe against a bad environment directory is a non-zero exit, which leaves the cache intact. So the
evidence's premise ("a failing probe reaches the pre-existing `command()` catch") is true only for
executable-level failures.

Consequence for a *different* environment: none that degrades correctness. A concurrent install
holds `executable` in a local `const` (`:640`), so clearing the field cannot affect work in flight.
A subsequent install/refresh re-runs `resolveExecutable()`, which is **directory-independent** (its
`--help` probes pass no `configDirectory`), costing up to two extra spawns per candidate. The only
degraded outcome — `resolveExecutable()` now throwing "Update Claude Code to continue: scoped plugin
marketplace removal is required" — requires `claude` to actually be broken at that moment, in which
case the install would have failed regardless. **Not worse than claimed.**

**3. Verdict mapping, adversarially — CONFIRMED on all three sub-questions.**
- `entry.enabled` off an untyped `Record<string, unknown>`: `claudePluginBridge.service.ts:450-453`
  tests `=== true` then `=== false` then falls through to `'unknown'`. A **missing** `enabled` is
  `undefined` → `'unknown'`. A non-boolean (`"true"`, `1`, `null`) → `'unknown'`. It cannot land on
  `'not_installed'`, because that return is reached only from `plugin === undefined` (`:450`).
  Mutation-verified: deleting the `=== false` branch fails the `disabled` assertion.
- Identity predicate: probe `:447-449` is
  `entry.id === this.dependencies.identity.pluginId && entry.scope === 'user'`; `inspectCurrent`
  `:487-489` is character-for-character the same expression. Probe and install cannot disagree about
  what "the plugin" is. **CONFIRMED.**
- `'unknown'` ↔ `'not_installed'` never substitute: `'not_installed'` has exactly one return site
  (`plugin === undefined`, i.e. a parsed list that genuinely lacks the entry); every failure path —
  `resolveExecutable()` throw, non-zero exit, `parseJsonArray` throw on unparseable/empty stdout —
  lands in the single `catch` returning `'unknown'` (`:454-459`), and the observation-service cache
  defaults to `'unknown'` when unwritten (`claudeObservation.service.ts:221`). Mutation-verified in
  both directions: making the `catch` return `'not_installed'` fails "a non-zero CLI exit must
  report unknown, never not_installed"; making the cache default `'not_installed'` fails scenarios
  5 and 8.

**4. `getSnapshot()` never spawns — CONFIRMED, and the test does pin the right function (with one
caveat).**
- (a) `EyesOnAgentsService.getSnapshot()` (`eyesOnAgents.service.ts:836`) reaches the observation
  service through exactly one call, `getDirectoryStatus?.()` at `:912`. Its only other Claude call
  is `readClaudeBridgeStatus()` (`:853` → `:3364` → `currentClaudeBridgeStatus()` at `:3382` →
  `claudeBridge.getStatus()`), and `getStatus()` (`claudePluginBridge.service.ts:346-415`) is
  synchronous — state file + `this.inspection` + `runtimeStatus()`, no `command()`. So
  `getDirectoryStatus()` *is* the function a snapshot invokes, and the 25-iteration test targets it
  correctly. Mutation-verified: adding `void this.refreshPluginPresence()` to `getDirectoryStatus()`
  fails the test.
- Caveat: the contract asked for "a stubbed **command runner**"; the test stubs the *probe
  dependency* one level up. Since `probePluginPresence` is the observation service's only route to a
  CLI process, the pin is equivalent in practice — worth knowing it is one abstraction shallower
  than specified.
- (b) No other hot path probes. `refreshPluginPresence` / `probePluginPresence` has exactly four
  callers repo-wide (`claudeObservation.service.ts:499`, `eyesOnAgents.service.ts:2923`, `:2983`,
  `:3003`) plus the handler wiring at `eyesOnAgents.handler.ts:252`. The poll timer path
  (`eyesOnAgents.service.ts:1052` → `claudeObservation.refresh('poll')`) returns early to
  `refreshEnvironment` per environment when `this.started` is true and never reconciles
  (`claudeObservation.service.ts:368-377`); it only reaches a probe by calling `start()` when not
  started, which is the sanctioned app-start trigger. The watcher broadcast callbacks
  (`eyesOnAgents.handler.ts:224`, `:227` → `invalidate` / `handleWatcherFailure`) never reconcile.

**5. Concurrency correctness — CONFIRMED on every sub-question, verified empirically not by
reading.** Scratch harness results:

```
A: second caller observed = installed          # coalesced caller sees the FRESH verdict
B: in-flight size after vanish = 0  cache has env-b = false
C: broadcasts during coalesced double refresh = 1
D: start survived a rejecting probe; env-a = unknown
```

- **No lost rejection.** `pending` is `probe(...).catch((): null => null)`
  (`claudeObservation.service.ts:174-175`) and the map stores `pending.then(...)` (`:176`) — neither
  can reject, so `await existing` (`:168`) cannot reject either.
- **No leaked map entry on the early-return path.** `if (!state) return;` (`:161`) happens *before*
  the `set`, so there is nothing to leak; and the `set`/`await` pair is wrapped so that
  `finally { this.pluginPresenceInFlight.delete(id) }` (`:189`) runs on every exit, including the
  `!this.environments.has(id)` early return (result B: map size 0, no resurrected entry).
- **The second caller does *not* observe a stale verdict.** The `.then()` reaction that resolves the
  map's promise is registered on `pending` *before* the first caller's `await pending`, so when
  `pending` settles the map promise resolves in the first microtask and schedules the second
  caller's continuation *after* the first caller's continuation — which is where the cache write
  happens. Verified (result A): with the cached verdict changing from `not_installed` to `installed`
  mid-flight, the coalesced second caller reads `installed` from `getDirectoryStatus()` the instant
  its `refreshPluginPresence` resolves. **Correct, but accidental** — it depends on registration
  order at `:176` vs `:179` and on the `.then` callback returning a non-thenable. A comment stating
  the invariant would be cheap insurance; I did not raise it as a separate P3 because nothing
  observable is wrong.
- **`probed` / `broadcastChanged` fire correctly.** A coalesced caller returns without setting
  `probed` (`:168-169`), so a fully-coalesced `refreshPluginPresence` invocation broadcasts zero
  times — correct, because the *owning* invocation broadcasts once (result C: exactly 1 broadcast
  for two overlapping refreshes). A failed probe sets neither cache nor `probed`, so it broadcasts
  zero times — also correct. Mutation-verified: removing the coalescing fails scenario 3.
- **A rejecting probe cannot take down startup** (result D), and it matters: `activateClaudeProvider`
  wraps `await claudeObservation.start()` in a `catch` that sets
  `claudeProviderProjectionEnabled = false` and `claudeProviderError`
  (`eyesOnAgents.service.ts:2652-2662`). The evidence's "real bug the new tests caught" is real and
  the containment at `:174-175` is the right fix. **CONFIRMED.**
- One escape hatch remains, but it is **pre-existing, not this task's**:
  `new Date((this.dependencies.now ?? Date.now)()).toISOString()` (`:184`) throws `RangeError:
  Invalid time value` for a non-finite `now()`, and that escapes to `start()`. I verified the same
  throw occurs with the probe dependency **not** wired at all (`F: start() THREW with NO probe
  wired: Invalid time value`), so the pattern is repo-wide and predates 090. Not reported.

**6. Trigger completeness — CONFIRMED, including the "rename spends no CLI calls" claim.**
- *App start* → `start()` → `hydrateAndReconcile()` (`:255`) → `reconcileEnvironments()` (`:436`) →
  probe. On a first run the environment map is empty, so every id lands in `staleIds` via the
  `else` branch (`:491-496`).
- *Environment added / directory changed* → the **real** XPC path is
  `eyesOnAgents.handler.ts:519-561`, which awaits `claudeObservation.applyEnvironments()` for all six
  CRUD members → `reconcileFromDirectoryConfig()` (`:339`, `:450-459`) → `reconcileEnvironments()`.
  (`EyesOnAgentsService`'s own `addClaudeEnvironment` / `chooseClaudeEnvironmentDirectory` /
  `useAutomaticClaudeEnvironment` at `:3053-3103` also call `applyEnvironments()`, but they are the
  `implements EyesOnAgentsApi` stubs and, as their own comment says, no renderer or XPC path reaches
  them.) A newly-added id is probed via the `else` branch; a changed `configDirectory` via `:484-487`.
- *Explicit install / refresh / retry on that row* → `:2923`, `:2983` (both pass
  `params?.environmentId`), plus plugin-**removal** at `:3003` (an extra trigger, disclosed in the
  evidence but not in the feature doc — see P3-9).
- *Nothing extra probes.* **"A rename spends no CLI calls" CONFIRMED**: `renameEnvironment` and
  `setEnvironmentEnabled` go through the same `applyEnvironments()`, hit the `existing` branch with
  an unchanged `configDirectory`, contribute nothing to `staleIds`, and `probeEnvironmentPresence([])`
  returns immediately on `ids.length === 0` (`:158`). Mutation-verified: replacing the
  directory-change guard with `if (true)` fails scenario 7's "renaming an environment must not
  re-probe it".

**7. Renderer collapse — one real loss (B1), one non-loss.**
- The per-row `setupAction === 'retry'` → **Retry listener** button was **not** the only path to
  that action: the card-level setup section still offers it at `ClaudeObservationCard.vue:315-324`
  (`v-else-if="setupAction === 'retry'"` → `handleRefresh`). It is also a genuinely profile-wide
  concern (one socket, one outbox), so card-level is its correct home. **No loss.**
- What *was* lost is the row-scoped Install/Repair/Finish/Enable for a row whose presence is
  `'installed'` → **B1**.
- One thing the collapse silently **improved**: the old block's `v-if` tested only `setupAction`, so
  it rendered on the synthetic invalid-hydration row too and would have dispatched
  `handleInstallForEnvironment('')` → "Claude environment was not found". The new block is gated on
  `v-if="environment.id"` (`:163`), so that dead button is gone. Not mentioned in the evidence.
- **`disabled` → Install really does enable — CONFIRMED.** `performInstall(configDirectory)` reaches
  `claudePluginBridge.service.ts:719-738`: when `this.inspection?.enablement === 'disabled'` it runs
  `plugin enable <pluginId> --scope user` against that directory and then re-inspects, treating the
  read-only inspection (not the exit code) as the success condition. It does **not** silently no-op.
  Note it is a heavy path — for an already-present plugin it does `marketplace update` +
  `plugin uninstall -y` + `plugin install` before the enable (`:691-714`) — but it is correct.
- **The layout doc matches the shipped template, ASCII diagram included.**
  `docs/integrations/eyes-on-agents-layout.md:324-353`: the prose now describes the per-row presence
  pill and the card-level-only global setup section, and the diagram's row order — header → path +
  directory actions → (Copy setup command) → meta → **presence pill + action** → Rename/Remove —
  matches the template's actual order (`ClaudeObservationCard.vue:154-217`). The stale sentence
  about the setup action being "repeated inside each row" is gone.

**8. Logging / leakage — CONFIRMED clean.** The commit adds **zero** log statements. The probe's
`catch` (`claudePluginBridge.service.ts:454-459`) swallows the error and nothing logs it upstream:
`probeEnvironmentPresence` applies `.catch((): null => null)` (`:174-175`) and never touches
`logEnvironmentLifecycle`; `refreshPluginPresence` cannot reject, so the `await` sites in
`eyesOnAgents.service.ts:2923` / `:2983` / `:3003` never hand an error to the XPC layer. No new path
carries a `configDirectory`, a CLI argv containing one, or CLI stdout/stderr toward `main.log`. The
only new user-visible strings are the six i18n labels, none of which interpolate a path.

**9. Single-environment users — CONFIRMED.** One automatic environment with the plugin installed:
the probe runs once at start with `configDirectory: undefined` (scenario 1 asserts exactly this, and
mutation-verified — probing the automatic row with a fabricated path fails the assertion), so the
row shows an `installed` pill. The global status is untouched — `getStatus()` was not modified, and
`claude-environment-plugin-install.test.mjs` asserts `getStatus()` is deep-equal across a probe
(load-bearing: it fails when the probe is made to call `inspectCurrent`). A pre-090 user whose probe
has not run reads `pluginPresence: 'unknown'` / `pluginProbedAt: null` from the empty-cache defaults
(`claudeObservation.service.ts:221-222`), never `'not_installed'` — pinned by scenario 8 and
mutation-verified. Note the row now always renders one extra line (the pill) where a fully healthy
single-environment user previously saw none; the contract explicitly sanctions that ("shows one row
with an `'installed'` pill").

**10. i18n + house conventions + scope — CONFIRMED clean.**
- i18n: the six new keys sit in **identical order** in both files (`en.ts:802-807`,
  `zh.ts:789-794`); I diffed the full `claudeEnvironment` key sequence programmatically — identical.
  Every key is reached via `i18nHelper.*`, each has exactly one use site, there are no orphans, and
  no `$t(` or `useI18n` appears anywhere in the diff.
- No `forEach` in the new code (0 matches across added lines); iteration is `for…of` and `.map`.
  Statements end with semicolons. New module-level functions are `const` + arrow
  (`presenceLabel`/`presenceClass` at `:530`, `:538`); class methods stay method shorthand.
- BEM stays flat and ≤ two `__`: `eyes-connection-card__status`,
  `eyes-connection-card__status--installed|--needs_review|--stopped`,
  `eyes-connection-card__directories-meta`. **No new CSS** — `ConnectionPanel.less` was not touched,
  as the Path's "only if" allowed.
- Both new buttons carry `size="mini"`; the new row block carries a stable, module-rooted `name`
  (`eyesOnAgents__connections__claudeEnvironmentPlugin`), consistent with its sibling
  `eyesOnAgents__connections__claudeEnvironmentGuidance`. `import type` is used for
  `EyesOnAgentsClaudePluginPresence` in both consuming files.
- **`package.json` diff contains ONLY the test wiring — CONFIRMED.** One line changed
  (`test:eyes-on-agents:claude`), appending
  `scripts/eyes-on-agents/claude-environment-install-probe.test.mjs` to the final `node --test`
  group. `name`, `version` and `version_code` are untouched.

## Mutation testing

Every mutation was applied in the scratch copy only. "kills" = the suite fails.

| # | mutation | result |
|---|---|---|
| M1 | drop `pluginPresence.delete(id)` on environment removal (`:473`) | **survives** — P3-1 |
| M2 | drop `pluginPresence.delete(id)` on directory change (`:485`) | **survives** — P3-1 |
| M3 | remove the in-flight coalescing (`:167-170`) | kills scenario 3 |
| M4 | a failed probe stamps a guessed `not_installed` | kills scenario 4 |
| M5 | `getDirectoryStatus()` triggers a probe | kills scenario 2 |
| M6 | cache default `'unknown'` → `'not_installed'` (`:221`) | kills scenarios 5 + 8 |
| M7 | probe the automatic environment with a fabricated path | kills scenario 1 |
| M8 | rename re-probes (drop the directory-change guard) | kills scenario 7 |
| M9 | probe also calls `inspectCurrent` | kills the plugin-install CLI-count test |
| M10 | drop `plugin.enabled === false` → `'disabled'` | kills the `disabled` assertion |
| M11 | probe `catch` returns `'not_installed'` | kills all three `unknown` assertions |
| M12 | offer Install for `'unknown'` rows | kills "an unprobed row offers Check rather than Install" |
| M13 | drop `not_installed` → `--stopped` pill class | **survives** — P3-2 |
| M14 | drop `installed` → `pluginInstalled` label | kills "each row shows its own plugin presence" |
| M15 | Install dispatches a hardcoded id instead of `environment.id` | kills the row-scoping assertion |

13 of 15 killed. The two survivors are the two `pluginPresence.delete(...)` calls (P3-1) and the
pill class mapping (P3-2).

## Evidence claims: confirmed vs inaccurate

### CONFIRMED

1. `this.inspection` is untouched — no existing read site edited, still one global slot (28
   insertions / 0 deletions in that file).
2. `inspectClaudeNamespace` is already per-directory and pure with respect to `this.inspection`.
3. The probe reuses `inspectCurrent`'s exact identity predicate, character for character.
4. Every row of the verdict-mapping table matches the code, and `'unknown'` is never folded into
   `'not_installed'` in either direction.
5. The `catch` deliberately swallows rather than logs, and nothing upstream logs it.
6. `marketplaces` is ignored; no installationId / digest / drift / collision semantics leak out.
7. The `this.executable` caveat is real and is a resolution cache, not installation state — and its
   consequences are **no worse** than the evidence claims (see priority check 2).
8. `getSnapshot()` never probes, and the 25-iteration test targets the function a snapshot actually
   calls.
9. `getDirectoryStatus()` stamps `pluginPresence` / `pluginProbedAt` at task 088's list-level
   position, and the synthetic invalid-hydration row is always `unknown` / `null`.
10. Coalescing is per id; different environments probe concurrently; three overlapping refreshes of
    one id share one probe.
11. A rejecting probe is contained and no longer takes down `start()` — and the "real bug the new
    tests caught" is genuinely load-bearing, since `activateClaudeProvider` would have flipped the
    whole Claude provider into an error state.
12. A rename and an enabled-flag flip spend no CLI calls.
13. Wired at the composition root to the same plugin-bridge instance the install actions use.
14. Install on a `disabled` row really does enable the plugin (`performInstall` `:719-738`).
15. `getStatus()` is byte-identical across a probe, and the assertion is load-bearing.
16. Typechecks clean; `:claude` all four groups `fail 0`; eslint 0 new errors with exactly the three
    expected pre-existing `prefer-const` errors at the stated lines; no Electron / packaged / E2E
    run; the real `claude` CLI never invoked.
17. The layout doc, including the ASCII diagram, matches the shipped template.

### INACCURATE

1. **"A removed environment's cached verdict is deleted with it, so a re-added id cannot inherit a
   verdict probed against a different directory"** is listed among the properties the new tests pin,
   and the Tests section credits scenario 6 with it ("a removed id's verdict is dropped and a re-add
   re-probes"). The *behaviour* is correct, but **no test pins the mechanism**: deleting
   `this.pluginPresence.delete(id)` (`:473`) leaves the whole suite green, because the re-add
   re-probes and overwrites the stale verdict regardless. Same for the directory-change delete at
   `:485`. This is the same class of overstatement earlier reviews in this plan caught (a "false
   defence-in-depth claim").
2. **"a failing probe reaches the pre-existing `command()` catch, which clears the `this.executable`
   resolution cache"** — only *executable-level* failures do (spawn error, timeout, output-limit
   kill). A **non-zero exit code**, which is the realistic outcome for a probe against a bad
   environment directory, takes the separate `:1536` branch and does **not** clear the cache. The
   caveat's trigger is narrower than stated.
3. **`getDirectoryStatus()` at `claudeObservation.service.ts:229-250`** — actual `202-226`.
4. **`reconcileEnvironments` at `:428-462`** — actual `465-500`. Off by 37; these look like
   pre-edit line numbers.
5. **`probeEnvironmentPresence(ids)` at `:157-193`** — actual `156-195`.
6. **`refreshPluginPresence(id?)` at `:147-153`** — actual `146-153`.
7. **the `probePluginPresence` dependency at `:126`** — actual `127`.
8. **the cache + coalescing map at `:129-142`** — actual `131-141`.
9. **`probePluginPresence` at `claudePluginBridge.service.ts:441-468`** — actual `441-460`.
10. **`inspectClaudeNamespace` at `:1381`** — actual `1382`. (The feature doc still says `:1354`,
    the pre-090 line, and was not updated — P3-9.)
11. **the explicit trigger sites at `eyesOnAgents.service.ts:2919`, `:2988`, `:3000`** — actual
    `2923`, `2983`, `3003`. All three wrong, in both directions.
12. **the composition-root wiring at `eyesOnAgents.handler.ts:248-250`** — actual `250-252`.
    (`ClaudeObservationCard.vue:162-189` and the helpers at `:528-545` are both correct.)

Two further statements are true but incomplete rather than wrong: "The probe spawns two `claude` CLI
processes per environment" understates the cold-cache cost, which is **four** (`resolveExecutable()`
adds two `--help` spawns per candidate and is not coalesced — P3-5); and the Tests bullet "the probe
issuing exactly one `plugin list` + one `plugin marketplace list`" describes an assertion that
filters on `--json`, so it does not in fact bound the total spawn count.
