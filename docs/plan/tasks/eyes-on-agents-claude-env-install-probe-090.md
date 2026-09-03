---
id: eyes-on-agents-claude-env-install-probe-090
scope: Add a read-only per-environment plugin-presence probe so each environment row reports whether its own CLAUDE_CONFIG_DIR actually has the Bitterless plugin
status: pending
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
