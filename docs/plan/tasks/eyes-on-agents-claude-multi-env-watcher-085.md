---
id: eyes-on-agents-claude-multi-env-watcher-085
scope: Run one independent JSONL/Desktop watcher supervisor per configured Claude environment
status: pending
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
