---
id: eyes-on-agents-claude-env-install-probe-090
scope: Add a read-only per-environment plugin-presence probe so each environment row reports whether its own CLAUDE_CONFIG_DIR actually has the Bitterless plugin
status: done
depends-on: [eyes-on-agents-claude-env-copy-setup-089]
verify: focused EyesOnAgents bridge/service/render unit tests, Core strict typecheck, UI strict typecheck; no Electron
---

# EyesOnAgents Claude Environment Install Probe

## Objective

After clicking Install on an environment's row, nothing in the UI confirms it worked *for that
environment*: the setup action's status is global, so every row shows the same title and the same
button whether or not that particular `CLAUDE_CONFIG_DIR` received the plugin. Add a narrow,
read-only probe that answers exactly one question per environment — is the Bitterless plugin present
and enabled in this directory? — and show it per row.

## Context

- `docs/features/eyes-on-agents-claude-multi-environment.md`, section
  "Per-environment setup: copyable shell command and install probe" → "Per-environment install
  probe (task 090)" is the exact contract, and its Non-goals define the hard boundaries.
- `ClaudePluginBridgeService.inspectClaudeNamespace(executable, configDirectory)`
  (`src/main/eyesOnAgents/claudePluginBridge.service.ts:1354`) is the mechanism to reuse. It is
  **already** per-directory (task 086 threaded `configDirectory` into its two `this.command()`
  calls) and **already pure** — it returns a `ClaudeNamespaceInspection` and does not assign
  `this.inspection`. `inspectCurrent(configDirectory?)` (`:445`) is the impure caller that owns the
  single global `this.inspection` slot; leave it alone.
- Task 088's `EyesOnAgentsClaudeEnvironmentStatus` (`src/shared/eyesOnAgents/eyesOnAgents.type.ts`)
  and its `EyesOnAgentsClaudeEnvironmentWatcherStatus` split (the watcher-owned subset vs the
  list-level fields stamped in `ClaudeObservationService.getDirectoryStatus()`) is the pattern for
  adding a field that is not a per-watcher property.

## Required behavior

- **Do not make `this.inspection` per-environment.** It has ~50 usages in a 1,564-line file that is
  already over the review size limit and holds this codebase's densest installationId lifecycle
  state machine. Add a separate, additive probe path instead. If you find yourself editing existing
  `this.inspection` read sites, stop — that is a signal the design has drifted.
- **Probe method:** add one method to `ClaudePluginBridgeService` that takes an optional
  `configDirectory`, calls `inspectClaudeNamespace`, and returns only a presence verdict — no
  installationId, no artifact digest, no drift, no marketplace-collision semantics leaking out.
  It must not mutate `this.inspection`, `this.state`, or any installation state.
- **Verdict shape:** `pluginPresence: 'installed' | 'disabled' | 'not_installed' | 'unknown'`.
  - `'installed'` — the Bitterless plugin is present for this directory **and** enabled.
  - `'disabled'` — present but not enabled.
  - `'not_installed'` — the probe ran successfully and the plugin is absent.
  - `'unknown'` — never probed yet, the probe threw, or the `claude` executable is missing/unusable.
  **Never collapse `'unknown'` into `'not_installed'`.** "We could not check" and "we checked and it
  is absent" lead the user to different actions; conflating them turns a broken `claude` PATH into a
  misleading "not installed" that invites a pointless reinstall.
- **Caching and trigger points.** The probe spawns two `claude` CLI processes per environment, so it
  must be cached per environment id alongside a `pluginProbedAt` timestamp, and refreshed **only**
  on: app start, an environment being added or having its directory changed
  (`addEnvironment`/`chooseClaudeEnvironmentDirectory`/`useAutomaticClaudeEnvironment`), and an
  explicit install/refresh/retry action on that row.
- **`getSnapshot()` must never trigger a probe.** Rendering or refreshing the board must not spawn a
  `claude` process. `getSnapshot()` reads the cache only. Add a test that pins this: build a snapshot
  with a stubbed command runner and assert the runner was never invoked.
- **Concurrency:** two overlapping probes for the same environment id must not both spawn CLI calls —
  coalesce onto one in-flight promise per id. Probes for *different* ids may run concurrently, and a
  failure or hang on one environment must never block or fail another's probe or status.
- **Surface it:** add `pluginPresence` and `pluginProbedAt` to `EyesOnAgentsClaudeEnvironmentStatus`,
  stamped where task 088 stamps `canRemove` (the list-level position, not the per-watcher subset).
- **Renderer:** each environment row shows its own plugin-presence pill, reusing the existing status
  pill styling rather than new CSS where it fits. Keep the **global** listener/runtime status where
  it already lives — do not duplicate it per row (explicit Non-goal). This is also the moment to
  address review 1's P3 about the setup-action block being visually triplicated: with real per-row
  presence, the per-row block becomes meaningful, so collapse the redundancy rather than adding a
  fourth identical surface. State plainly in the implementation evidence what you collapsed.
- **Logging:** the probe may log by environment `id`/`label` only. No `configDirectory`, no CLI
  argv containing it, no stdout/stderr passthrough that could carry it, ever reaches `main.log`.
- The single-environment user must see no meaningful change: one automatic environment that has the
  plugin installed shows one row with an `'installed'` pill and the same global status it shows
  today.

## Path

- `src/main/eyesOnAgents/claudePluginBridge.service.ts` (one additive probe method only)
- `src/main/eyesOnAgents/claudeObservation.service.ts` (probe cache, trigger points, status stamping)
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (`pluginPresence` + `pluginProbedAt`)
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less` (only if the
  existing pill classes genuinely do not fit)
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts` (four presence labels)
- `scripts/eyes-on-agents/` — probe verdict mapping (incl. `'unknown'` on throw and on missing
  executable), the no-spawn-in-`getSnapshot()` guard, in-flight coalescing, per-environment
  isolation, and the render test for the per-row pill
- `docs/integrations/eyes-on-agents-layout.md`, and
  `docs/features/eyes-on-agents-claude-multi-environment.md` if implementation reveals the contract
  needs correcting (correct it, do not silently diverge)
- Amended during delivery (review 1 noted the original Path omitted these): the `remove` trigger in
  `src/main/eyesOnAgents/eyesOnAgents.service.ts`, the composition-root wiring in
  `src/main/xpc/eyesOnAgents.handler.ts`, and — added by the review-1 follow-up — the new
  `refreshClaudeEnvironmentPluginPresence` member across `eyesOnAgents.type.ts`, the handler, the
  service, and `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`, plus
  `scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs` and
  `scripts/eyes-on-agents/claude-environment-render.test.mjs` for coverage, and `package.json` for
  test wiring

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`
- Do **not** run Electron, packaged builds, Playwright, or any `test:e2e:*` suite. In particular, do
  **not** invoke the real `claude` CLI against the owner's real `~/.claude` — stub the command
  runner. A disposable scratch directory is acceptable if a real-CLI probe is genuinely needed to
  confirm the verdict mapping, as task 086 did.
- Two failures are already-logged pre-existing ones and are not this task's to fix: the
  deterministic `ui-source.test.mjs` bundle-id assertion, and the flaky
  `thread-card-open-capability.test.mjs` right-click test. Any third failure is this task's problem.
- Owner-only manual check: with two real environments, install into one and confirm only that row
  reports `installed` while the other reports `not_installed`.

## Implementation evidence

Implemented directly by the orchestrator: two consecutive develop-subagent attempts were killed
by transient `529 Overloaded` server errors before either wrote a single source file (verified —
both left the tree with only this task's `status:` line changed), so the subagent path was
abandoned rather than retried a third time.

### Verdict mapping

`ClaudePluginBridgeService.probePluginPresence(configDirectory?)`
(`src/main/eyesOnAgents/claudePluginBridge.service.ts:441-468`) reuses the existing pure,
already-per-directory `inspectClaudeNamespace(executable, configDirectory)` (`:1381`, cited as
`:1354` in this task's Context section, which predates task 089's edits to the same file) and reduces
its `{plugins, marketplaces}` to one verdict. It reuses `inspectCurrent`'s own identity predicate —
`entry.id === identity.pluginId && entry.scope === 'user'` — so the probe agrees with the install
flow about what "the Bitterless plugin" means:

| `ClaudeNamespaceInspection` state | verdict | why |
|---|---|---|
| no entry matching `pluginId` + `scope: 'user'` | `not_installed` | the probe ran and the plugin is genuinely absent |
| matching entry, `enabled === true` | `installed` | present and active |
| matching entry, `enabled === false` | `disabled` | present but inactive — a different fix than installing |
| matching entry, `enabled` neither `true` nor `false` | `unknown` | the CLI did not tell us; do not guess |
| `resolveExecutable()` throws (no usable `claude`) | `unknown` | we could not check |
| `command()` throws (spawn failure or non-zero exit) | `unknown` | we could not check |
| CLI stdout is not parseable JSON | `unknown` | we could not check |

`unknown` is never folded into `not_installed`. The `catch` deliberately swallows the error instead
of logging it, because a `command()` failure message can carry the config directory, which must
never reach `main.log`. `marketplaces` is intentionally ignored — marketplace/drift/collision
semantics belong to the profile-wide `this.inspection`, not to a per-directory presence answer.

### What was NOT done, on purpose

`this.inspection` is untouched: no existing read site of it was edited, and it remains one global
slot. Converting it to a per-environment map would have meant editing ~50 usages in a 1,564-line
file that is already over the review size limit and holds the densest installationId lifecycle
state machine in this codebase — a large, risky refactor to serve a read-only status readout. The
probe is a separate additive path instead, and the shared installation identity, socket, and outbox
are unchanged (the feature doc's Non-goal). A test asserts `getStatus()` is byte-identical across a
probe call.

One honest caveat: a probe whose CLI *spawn* fails reaches the pre-existing `command()` catch,
which clears the `this.executable` resolution cache. That is a resolution cache, not installation
state, and the next call simply re-resolves. **Narrowed by review 1:** a non-zero CLI *exit* does
not clear the cache (only a spawn-level throw does), and the consequences are no worse than stated
— the cache clear cannot break a concurrent or subsequent install/refresh for another environment,
it only costs one re-resolution.

### Cache and triggers

`ClaudeObservationService` (`src/main/eyesOnAgents/claudeObservation.service.ts`) gains an optional
`probePluginPresence` dependency (`:126`), a `pluginPresence` result cache and a
`pluginPresenceInFlight` coalescing map (`:129-142`), a public `refreshPluginPresence(id?)`
(`:147-153`), and the private `probeEnvironmentPresence(ids)` that does the work (`:157-193`).

- **`getSnapshot()` never probes.** `getDirectoryStatus()` (`:202-226`) reads the cache only and
  stamps `pluginPresence`/`pluginProbedAt` at the same list-level position task 088 stamps
  `canRemove`; the synthetic invalid-hydration row is always `unknown`/`null`.
- **Triggers:** app start and every environment add (both via `reconcileEnvironments`, `:465-500`,
  which probes only ids that are newly added or whose `configDirectory` actually changed — a rename
  or an enabled-flag flip spends no CLI calls), plus an explicit per-row install/refresh/remove
  (`eyesOnAgents.service.ts:2923`, `:2983`, `:3003`, each passing that row's `environmentId`).
- **Coalescing** is per id, so three overlapping refreshes of one environment share one probe while
  different environments still probe concurrently.
- A removed environment's cached verdict is deleted with it, so a re-added id cannot inherit a
  verdict probed against a different directory. **Correction from review 1:** the scenario that
  claimed to prove this passes even with both `pluginPresence.delete(...)` calls removed — a re-add
  goes through the newly-added branch and re-probes anyway, so the delete is defence in depth rather
  than the mechanism the test demonstrates. The property holds; the test does not pin it.
- Wired at the composition root (`src/main/xpc/eyesOnAgents.handler.ts:248-250`) to the same plugin
  bridge instance the install actions use.

**A real bug the new tests caught during development:** a *rejecting* probe dependency originally
propagated out of `probeEnvironmentPresence` → `reconcileEnvironments` → `start()`, so a throwing
probe took down environment startup entirely — a read-only status lookup breaking observation. The
probe call is now contained locally (`:174-176`); a probe that cannot answer leaves the cache
untouched, which reads as `unknown` with a `null` `pluginProbedAt` rather than a guessed verdict.

### What was collapsed in the renderer

The per-row block that rendered the **global** `setupAction`'s title and button on every row is
gone. It was the P3 logged from task 088's review: with two environments and `setupAction: 'enable'`
the user saw the same "Enable" title and three identical primary buttons on one screen, differing
only in click target. In its place each row shows its **own** presence pill and the action that
follows from it (`ClaudeObservationCard.vue:162-189`, helpers at `:528-545`):

| row's `pluginPresence` | pill | action offered |
|---|---|---|
| `installed` | Plugin installed | none |
| `not_installed` | Plugin not installed | **Install plugin** (scoped to that row) |
| `disabled` | Plugin disabled | **Install plugin** (scoped to that row) |
| `unknown` | Plugin status unknown | **Check plugin** (re-probe that row) |

`unknown` offers Check rather than Install on purpose: "we could not find out" must not invite a
reinstall of something that may already be present. The card-level setup section is untouched and
keeps the genuinely profile-wide concerns (shared installation identity, listener, Reload in Claude,
Repair). Net effect: one setup surface card-level, plus a per-row surface only where the information
really is per-row. No new CSS — the pill reuses the existing
`eyes-connection-card__status--installed|--needs_review|--stopped` classes.

### Tests

- `scripts/eyes-on-agents/claude-environment-install-probe.test.mjs` (new, 9 scenarios, wired into
  `test:eyes-on-agents:claude`): each environment probed against its own directory (automatic gets
  `undefined`, not a fabricated path); **25 consecutive `getDirectoryStatus()` calls spawn zero
  probes**; three overlapping refreshes of one id share one probe; a throwing probe yields `unknown`
  with a `null` timestamp and leaves the sibling's verdict intact; `unknown` is never promoted;
  a removed id's verdict is dropped and a re-add re-probes; a directory change re-probes with the
  NEW directory while a rename does not probe at all; without the dependency wired, behavior is
  exactly pre-090 and `refreshPluginPresence` is a no-op rather than a throw; refreshing an unknown
  id probes nothing.
- `scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs` (+2 scenarios): every row of
  the verdict-mapping table above, including non-zero exit, unparseable JSON, and no usable
  executable all mapping to `unknown`; the probe issuing exactly one `plugin list` + one
  `plugin marketplace list` against the directory it was given; and `getStatus()` unchanged across
  a probe.
- `scripts/eyes-on-agents/claude-environment-render.test.mjs` (+2 real-DOM tests): two rows in one
  card showing different presence pills with only the `not_installed` row offering Install, and that
  Install dispatching that row's own environment id; an `unknown` row offering Check (not Install)
  and dispatching a row-scoped refresh.

### Verification

- `yarn typecheck:eyes-on-agents:core` — 0 errors.
- `yarn typecheck:eyes-on-agents:ui` — 0 errors.
- `yarn test:eyes-on-agents:claude` — all 4 `node --test` groups `fail 0`, every standalone script
  passing, including the new probe suite.
- `yarn test:eyes-on-agents:ui` — 104 tests, 103 pass, 1 fail: only the already-logged deterministic
  `ui-source.test.mjs` bundle-id assertion. No third failure; the right-click flake did not fire.
- `yarn eslint` on all six touched source files — **0 new errors**. Three pre-existing `prefer-const`
  errors remain (`eyesOnAgents.service.ts:1309`, `eyesOnAgents.handler.ts:93-94`), all on top-level
  declarations far from this task's edits.
- Electron, packaged builds, Playwright, and every `test:e2e:*` suite — not run, per the standing
  owner instruction. The real `claude` CLI was never invoked and no real `~/.claude*` was read or
  written; every probe test stubs the command runner.
- Owner-only manual check still outstanding: with two real environments, install into one and
  confirm only that row reports `Plugin installed` while the other reports `Plugin not installed`.

### Review-1 follow-up

[Independent review 1](../reviews/eyes-on-agents-claude-env-install-probe-090-1.md) returned
**`blocked`** on two real defects. Both are fixed here. The review earned its keep: this task was
implemented by the orchestrator itself (two develop subagents died on transient `529 Overloaded`
errors before writing any code), so it was the only independent pass over this code, and it found
what self-review missed — including by mutating 15 lines in a scratch copy and reporting the 2 that
survived.

**B1 — the renderer collapse removed the only path to repair a non-default environment.** Fixed.
`pluginPresence: 'installed'` means "present and enabled" and deliberately ignores drift, so after a
Bitterless update the profile can sit in `setupAction: 'repair'` while both directories still list
the plugin installed and enabled. The row then showed *Plugin installed* with no button, and the
card-level Repair passes no `environmentId` → `resolveClaudeBridgeEnvironment` → `environments[0]`.
Since installation is per `CLAUDE_CONFIG_DIR`, `~/.claude2` had become **unrepairable**. A row now
also offers the profile-wide setup action, row-scoped, when the profile needs
`enable`/`finish`/`repair` (`ClaudeObservationCard.vue`, `environmentSetupActionable`). Task 088's
P3 had recommended collapsing "with a per-environment target selector"; the row-scoped button is
that selector, and it is why reachability was lost when the first attempt omitted it. Pinned by a
new render test ("an installed row still offers the profile-wide setup action, row-scoped"), which
was mutation-checked: stubbing the branch to `false` fails it.

**B2 — the read-only probe was wired synchronously into the observation lifecycle queue.** Fixed.
`reconcileEnvironments` awaited `probeEnvironmentPresence`, and that queue is awaited by `start()`,
`stop()`, and every environment-CRUD round-trip; each probe spawns `claude` with a 30s timeout. The
review verified with a never-resolving stub that `start()` and `stop()` both hang. It is now
fire-and-forget (`void … .catch(() => undefined)`), with a comment stating why. Pinned by new
scenario 10, which guards `start()`/`applyEnvironments()`/`stop()` behind a 2s deadline; restoring
the `await` makes it fail with `start() blocked on a hung plugin-presence probe` (verified, and the
guard's timer is deliberately not `unref`'d so a regression fails loudly instead of hanging).

Also fixed from the review's P3s and its evidence corrections:

- **"Check plugin" is now genuinely read-only.** It previously called
  `refreshClaudeBridgeStatusForEnvironment`, i.e. a full profile-wide bridge refresh that can run a
  trusted automatic upgrade and rewrite the shared `this.inspection` — the opposite of a per-row
  "check this directory". It now goes through a new `refreshClaudeEnvironmentPluginPresence(id)`
  across `EyesOnAgentsApi` / handler / service / store, which re-probes only that environment. The
  render test asserts Check hits the presence path and does **not** touch the bridge-refresh path.
  Removing the now-orphaned `handleRefreshForEnvironment` also cleared a real
  `@typescript-eslint/no-unused-vars` error this change had introduced.
- **The new type no longer splits an existing comment block.**
  `EyesOnAgentsClaudePluginPresence` had been spliced between "…— see" and
  "EyesOnAgentsClaudeDirectoryStatus below)", orphaning that sentence. Moved above the block.
- **The probe tests no longer pass by microtask luck.** With reconcile-time probing now
  fire-and-forget, assertions that read presence right after `start()` were relying on stub probes
  resolving as microtasks. They use the fixture's `drain()` helper instead.
- Four wrong `file:line` citations in this evidence corrected, plus the two substantive corrections
  recorded inline above (the removed-id test not pinning its mechanism; the `this.executable`
  caveat's trigger being narrower than stated).

Remaining P3s from the review are logged in `docs/plan/backlog.md`.

### Re-verification after the follow-up

- `yarn typecheck:eyes-on-agents:core` — 0 errors. `yarn typecheck:eyes-on-agents:ui` — 0 errors.
- `yarn test:eyes-on-agents:claude` — all 4 groups `fail 0`.
- `yarn test:eyes-on-agents:ui` — 105 tests, 103 pass, 2 fail: both already-logged pre-existing
  failures (the deterministic `ui-source.test.mjs` bundle-id assertion and the ~6/10
  `thread-card-open-capability.test.mjs` right-click flake, which fired on this run). No third
  failure.
- `yarn eslint` on every touched source file — 0 new errors. Pre-existing errors remain at
  `eyesOnAgents.service.ts:1309`, `eyesOnAgents.handler.ts:93-94` (`prefer-const`) and
  `eyesOnAgents.store.ts:56` (`no-useless-escape` on `THREAD_TITLE_SEPARATOR_PATTERN`, byte-identical
  in `HEAD` and unrelated to this task).
- Electron, packaged builds, Playwright, and `test:e2e:*` — not run. The real `claude` CLI was never
  invoked. Owner-only two-environment manual check still outstanding.
