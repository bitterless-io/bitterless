---
id: eyes-on-agents-open-status-sync-029
scope: sync one thread's runtime status on Open and reclaim an unauthoritative active row
status: implemented; owner verification pending
depends-on: [eyes-on-agents-working-recovery-027, eyes-on-agents-active-focus-read-semantics-028]
---

# EyesOnAgents Open Status Sync

## Objective

Make an explicit `Open` at least as strong as waiting for the tiered poll: resolve that one thread's
runtime status from existing content-free evidence, covering both a persisted `discovery + unknown`
row and a persisted-active row whose Hook authority is currently absent.

Follow-up
[eyes-on-agents-completed-unknown-open-034](eyes-on-agents-completed-unknown-open-034.md)
supersedes only the call order below: status sync now runs after successful deep-link launch and
before final `markOpened`, so a terminal state discovered by that sync is acknowledged in one click.

## Required behavior

- After a successful deep link, run one status sync for that thread only. Reuse the
  existing newest-turn request, the existing candidate classification, and the existing repository
  patch path; add no new protocol, interval, or authority.
- The sync is best effort. A disconnected App Server, a request rejection, a malformed response, or
  a cancelled operation must leave the successful Open and its recorded evidence unchanged, and must
  not surface an action error.
- Issue no request when the thread is neither an active candidate nor a recovery candidate.
- Run the sync inside the existing App Server operation fencing so it cannot overlap a teardown, a
  foreground sync, or the background refresh.
- Extend the refresh candidate with the persisted runtime state so the shared projection can decide,
  through `effectiveEyesOnAgentsRuntimeState`, whether a persisted-active row's authority is
  currently absent.
- Add a reclaim patch: when authority is absent and the newest turn is `inProgress` with an ID
  matching the exact persisted active turn and a persisted start time no later than the poll, move
  the row to the `app_server_turn` source, set the start time as the status watermark and an
  activity floor, and preserve `runtime_state` and `active_flags_json`.
- Apply the reclaim atomically only when the row is still non-archived, `codex_hook`-sourced, in an
  active runtime state, on the exact expected active turn ID and status watermark, and has not
  already recorded that turn as completed.
- Keep `inProgress` a no-op for a row whose authority is present. Terminal reconciliation, missed
  working recovery, and reclaim remain mutually exclusive for one thread in one pass, enforced at
  the shared XPC/repository boundary.
- The ten-second poll shares the projection and therefore gains the same reclaim. No new polling
  interval, elapsed-time inference, transcript scan, or `paused` state is introduced.

## Expected paths

- `docs/issues/eyes-on-agents-open-does-not-resolve-unknown.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/plan/README.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Core coverage proves Open issues exactly one newest-turn request for an eligible thread, none for
  an ineligible one, and that a throwing or disconnected App Server still resolves the Open.
- Core coverage proves `inProgress` reclaims only when the projection reports absent authority, and
  remains a no-op when authority is present.
- Repository coverage proves the reclaim compare-and-set against the exact prior row, its rejection
  cases, that it preserves `runtime_state` / `active_flags_json` / `is_unread`, and that a reclaimed
  row then survives discovery and reconnect and is terminally reconcilable under its own source.
- Boundary coverage proves the patch parser accepts the reclaim shape and rejects any two of
  terminal / recovered / reclaimed in one patch.
- Run the EyesOnAgents non-Electron suites, Node typecheck, `yarn build`, and `git diff --check`.
  Ral owns runtime verification in Electron.
