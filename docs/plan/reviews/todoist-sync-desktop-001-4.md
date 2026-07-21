# Todoist-style Desktop Synchronization Review — Round 4

Status: passed

Date: 2026-07-21

Task: [todoist-sync-desktop-001](../tasks/todoist-sync-desktop-001.md)

## Findings

None.

## Round-3 finding resolution

- **Permanent-error projection lifecycle: resolved.** The desktop analysis now includes
  `error_waiting_resource` in the active outbox state machine and optimistic projection. A permanent
  error with non-null canonical revision/reference keeps its rejected overlay non-sendable and
  pull-only until the referenced resource proves the required revision; only then does it transition
  to non-projecting `permanent_failed`. When both projection fields are null, rollback to
  `permanent_failed` remains immediate (`docs/plan/analysis/todoist-sync.md:45-63`). This matches the
  feature contract (`docs/features/todoist-sync.md:235-296`), desktop task contract and tests
  (`docs/plan/tasks/todoist-sync-desktop-001.md:64-74`, `:103-109`), root overview
  (`areas/agent-runtime/todo/todo-sync.html:378-393`), and backend contract
  (`projects/bitterless-private/docs/features/todoist-sync.md:443-470`).

## Regression scan

- The exact request/status/error envelope contract remains aligned, including common command
  versions, `server_time_ms`, and canonical resource references.
- `CLOCK_SKEW` still uses the renderer-triggered generation-fenced check, exact no-receipt UUID
  quarantine, pull-only progress while NTP is unreachable, and healthy recovery that re-identifies
  only proven future-dated commands. Greater/equal/lower baseline wording remains monotonic.
- The Todo desktop task remains the sole owner of its migration manifest/fixtures/audit registration;
  the final SQLite release gate depends on it. Desktop completion still requires both backend tasks
  and the real non-production two-client Core/PostgreSQL smoke.

## Conclusion

**Pass.** The only round-3 blocker is resolved, and the quick regression scan found no drift in the
three previously corrected contract areas. The documentation set is internally consistent enough
for `todoist-sync-desktop-001` implementation to proceed, subject to its recorded verification and
external backend completion gates.

## Verification boundary

This was a read-only contract review of the latest desktop feature/analysis/task, SQLite
release-gate analysis/task and plan index, root Todo sync HTML overview, and backend feature
contract. No product document or code was changed beyond this review artifact. No test, typecheck,
build, Electron process, database operation, credential access, or network request was run.
