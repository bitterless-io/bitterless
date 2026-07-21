# Todoist-style Desktop Synchronization Review — Round 3

Status: blocked

Date: 2026-07-21

Task: [todoist-sync-desktop-001](../tasks/todoist-sync-desktop-001.md)

## Finding

1. **P2 · blocking — the desktop analysis still specifies the old permanent-error projection
   lifecycle.** The active-outbox diagram omits `error_waiting_resource`, routes permanent errors
   directly from `in_flight` to `permanent_failed`, and says permanent failures never participate in
   optimistic projection (`docs/plan/analysis/todoist-sync.md:45-58`). That contradicts the corrected
   desktop feature contract, where a permanent error with non-null canonical reference/revision
   enters `error_waiting_resource`, remains a non-sendable pull-only overlay, and rolls back only
   after the referenced row arrives at the required revision
   (`docs/features/todoist-sync.md:235-238`, `:240-263`, `:281-296`). The desktop task now requires
   that state and its delayed-page/restart tests (`docs/plan/tasks/todoist-sync-desktop-001.md:64-74`,
   `:103-109`), and Core requires the same behavior
   (`projects/bitterless-private/docs/features/todoist-sync.md:443-470`). Update the analysis state
   diagram and projection paragraph to include `error_waiting_resource`; distinguish its deferred
   rollback from a permanent error whose projection fields are both null.

## Round-2 resolution assessment

- **Exact wire examples and envelopes: resolved.** The desktop request includes the common command
  version fields, its HTTP 200 example includes `server_time_ms` and `canonical_resource`, and its
  strict status/envelope prose delegates the exhaustive variants to the backend contract
  (`docs/features/todoist-sync.md:90-158`). The root overview now carries the same success fields and
  request-level `CLOCK_SKEW` shape
  (`areas/agent-runtime/todo/todo-sync.html:327-363`). The desktop task links the backend contract and
  requires byte-for-field shared fixtures for request, 200, permanent status, 400, 409, and 503.
- **Permanent-error resource waiting: partially resolved; finding 1 remains.** Feature, task, root
  overview, and backend now agree on non-null canonical proof versus immediate null-projection
  rollback (`docs/features/todoist-sync.md:235-296`;
  `docs/plan/tasks/todoist-sync-desktop-001.md:64-74`, `:103-109`;
  `areas/agent-runtime/todo/todo-sync.html:378-393`;
  `projects/bitterless-private/docs/features/todoist-sync.md:443-470`). Only the required desktop
  analysis remains stale.
- **`CLOCK_SKEW` event, quarantine, pull-only behavior, and baseline wording: resolved.** The desktop
  contract and root overview use `todoist-sync/clock-check-requested`, quarantine exactly the rejected
  UUID batch without receipts, keep pull-only synchronization available when NTP is unreachable, and
  re-identify only proven future-dated commands after a successful healthy sample
  (`docs/features/todoist-sync.md:329-356`;
  `areas/agent-runtime/todo/todo-sync.html:397-405`). The root baseline step now explicitly specifies
  greater/equal/lower revision behavior (`areas/agent-runtime/todo/todo-sync.html:254-259`).
- **Serial ownership and backend completion prerequisite: resolved.** The desktop task solely owns
  the Todo manifest/fixtures/audit registration; the final SQLite gate depends on it and consumes the
  result (`docs/plan/analysis/todoist-sync.md:109-123`;
  `docs/plan/analysis/sqlite-migration-release-gate.md:59-67`). The release-gate task and plan index
  both record `todoist-sync-desktop-001` as the dependency
  (`docs/plan/tasks/sqlite-migration-release-gate-001.md:1-10`, `:73-79`;
  `docs/plan/README.md:61`). The desktop task cannot be marked done until both backend tasks pass and
  the real non-production Core/PostgreSQL two-client smoke succeeds
  (`docs/plan/tasks/todoist-sync-desktop-001.md:134-139`).

## Conclusion

**Blocked.** Three round-2 blockers are fully resolved, and the permanent-error lifecycle is aligned
in every implementation-facing contract except the desktop analysis. Implementation should wait
until that analysis no longer directs permanent errors to remove their overlay before canonical
resource proof.

## Verification boundary

This was a read-only contract review of the latest desktop feature/analysis/task, SQLite
release-gate feature/analysis/task and plan index, root Todo sync HTML overview, and backend feature
contract. No product document or code was changed beyond this review artifact. No test, typecheck,
build, Electron process, database operation, credential access, or network request was run.
