# Todoist Sync Desktop Review 6

Commit reviewed: `f08dae2`
Prior review: `docs/plan/reviews/todoist-sync-desktop-001-5.md`

## PASS

The requested phase-2 verification slice passes independent review.

- Remote Todo projection changes generate the expected event mapping with `actor='system'` in [`src/main/todoistSync/todoistSync.repository.ts:1318`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/main/todoistSync/todoistSync.repository.ts:1318). Remote application only updates baselines/projections/events inside the repository transaction and does not insert outbox commands; the focused test verifies the complete create/update/complete/move/star/delete sequence and an empty outbox at [`scripts/todoist-sync/native.test.ts:666`](/Users/ral/Documents/projects/overmind/projects/bitterless/scripts/todoist-sync/native.test.ts:666).
- HTTP responses are fenced after network return and again through the transaction's pre-commit callback. A stale response releases its in-flight batch and returns without response state, token, baseline, projection, or follow-up scheduling; the transaction rollback boundary is [`src/main/todoistSync/todoistSync.database.ts:122`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/main/todoistSync/todoistSync.database.ts:122), with coordinator checks at [`src/main/todoistSync/todoistSync.coordinator.ts:195`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/main/todoistSync/todoistSync.coordinator.ts:195) and repository fencing at [`src/main/todoistSync/todoistSync.repository.ts:861`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/main/todoistSync/todoistSync.repository.ts:861). The commit-fence test confirms the local projection survives, token remains `*`, no baseline is written, and no timer is scheduled at [`scripts/todoist-sync/native.test.ts:1193`](/Users/ral/Documents/projects/overmind/projects/bitterless/scripts/todoist-sync/native.test.ts:1193).
- Strict request, HTTP-200, permanent-status, and 400/409/503 error parsing is covered by shared fixtures. The parser enforces exact keys, command UUID coverage, command/resource shape, phase flags, duplicate-resource rejection, error-code/status pairing, and the `CLOCK_SKEW` bound in [`src/shared/todoistSync/todoistSync.contract.ts:220`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/shared/todoistSync/todoistSync.contract.ts:220) and [`src/shared/todoistSync/todoistSync.contract.ts:364`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/shared/todoistSync/todoistSync.contract.ts:364).
- Scheduler and session behavior satisfies the reviewed contract: coordinator single-flight/coalesced rerun, completion-relative interval, bounded transient backoff, persisted-token restart, serialized session transitions, customer isolation, and late-result fencing are implemented at [`src/main/todoistSync/todoistSync.coordinator.ts:120`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/main/todoistSync/todoistSync.coordinator.ts:120) and [`src/main/todoistSync/todoistSync.session.ts:89`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/main/todoistSync/todoistSync.session.ts:89).
- Clock behavior matches the requested boundaries: exactly 180 seconds is healthy, greater offset is `clock_wrong`, unreachable checks preserve the prior marker, overlapping checks fence late results, and session deactivation prevents late persistence at [`src/main/todoistSync/todoistSyncClock.service.ts:151`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/main/todoistSync/todoistSyncClock.service.ts:151). Core `CLOCK_SKEW` quarantines the exact submitted batch, continues pull-only sync, and healthy NTP recovery rewrites only future-dated members; a healthy NTP result that cannot explain the Core rejection remains quarantined with the disagreement diagnostic at [`src/main/todoistSync/todoistSync.repository.ts:793`](/Users/ral/Documents/projects/overmind/projects/bitterless/src/main/todoistSync/todoistSync.repository.ts:793).

## BLOCKED

The overall Todo sync feature remains blocked from completion. `docs/plan/tasks/todoist-sync-desktop-001.md` is still `in-progress`; Todo 7 renderer/web/runtime/build/Electron gates and Todo 8's backend-dependent two-client HTTP smoke remain outstanding, and the `bitterless-private` backend prerequisites have not been independently verified here.

## Findings

No new blocking or non-blocking finding was identified in the requested phase-2 slice.

## Results

- `yarn typecheck:todoist-sync` — PASS
- `yarn test:todoist-sync` — PASS, 17/17 focused native tests
- `yarn typecheck:mcp` — PASS
- `git diff --check` — PASS

Per request, no full TypeScript check/build, Electron GUI run, remote HTTP, remote database, or two-client Core/PostgreSQL smoke was run.

## Remaining Scope

- Run the task's remaining renderer/web/runtime/build and Electron handoff gates.
- Run the non-production two-client HTTP smoke only after `todoist-sync-backend-001` and `todoist-sync-backend-integration-002` pass in `bitterless-private`.
- Keep the task `in-progress` until those gates and the external completion prerequisite are green.
