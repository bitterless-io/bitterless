# Todoist-style Desktop Synchronization Review — Round 1

Status: blocked

Date: 2026-07-21

Task: [todoist-sync-desktop-001](../tasks/todoist-sync-desktop-001.md)

## Findings

1. **P1 · blocking — the new persistent database is outside the release migration gate.**
   `docs/features/todoist-sync.md:34-62` introduces one durable encrypted
   `todoist-sync-v1/customer-<customerId>.db` per customer, and
   `docs/plan/analysis/todoist-sync.md:7` explicitly assigns schema/migrations to
   `todoistSync.database`. However, `docs/features/sqlite-migration-release-gate.md:9-20` still
   defines exactly two persisted databases (`main.db` and `config.db`), while its contract at
   `:33-44` requires every database to own a runtime/audit-shared ordered manifest. Neither Todoist
   task includes that manifest, historical/fresh upgrade fixtures, `integrity_check`,
   `foreign_key_check`, rollback evidence, or `yarn audit:sqlite-migrations`. A signed build could
   therefore pass the documented release gate without proving the new Todo database can upgrade.
   Add the per-customer database to the migration-gate contract and audit, and make task 001 own a
   real manifest plus fresh/reopen/upgrade/failure fixtures.

2. **P1 · blocking — a future-dated outbox is not recoverable after the clock is corrected.**
   Local commands durably capture `Date.now()` and retain one UUID across retries
   (`docs/features/todoist-sync.md:171-177`, `:91-92`). Core now rejects the whole batch, applies
   nothing, and stores no UUID receipt when any timestamp is more than 180 seconds in the future
   (`:232-235`). The later healthy SNTP result promises to resume the coordinator (`:237-240`), but
   the queued command still carries the old future timestamp, so an unchanged retry receives the
   same rejection until wall time catches up. This can be minutes or years and contradicts the safe
   outbox/automatic-resume contract. Define an atomic recovery transition after a confirmed healthy
   check—including how affected resource versions, command UUIDs, sequence/order, and the no-receipt
   guarantee are handled—and add a test that a far-future local edit actually drains after clock
   repair.

3. **P2 · blocking — task 001 cannot reach its own independently verifiable state.**
   Task 001 says to remove every PowerSync artifact, including `src/main/todoSync/` and
   `src/main/xpc/todoPowerSync.handler.ts`, then pass node/MCP typechecks
   (`docs/plan/tasks/todoist-sync-desktop-001.md:8-49`). The cutover call sites are reserved for task
   002 (`docs/plan/tasks/todoist-sync-desktop-integration-002.md:21-36`): current imports still exist
   in `src/main/xpc/xpc.helper.ts:18`, `src/main/xpc/auth.handler.ts:18`,
   `src/main/mcp/mcpBridge.server.ts:34-68`, and the Home/Todo renderer emitters. Removing task 001's
   files first therefore leaves unresolved imports before task 002 may start. The task also changes
   native packaging but has no executable focused test command, runtime-asset check, or build gate;
   those are deferred to task 002. Either keep the old integration/dependency until task 002 and
   narrow task 001's objective, or merge/broaden the cutover so task 001 typechecks and verifies its
   own package state.

4. **P2 · blocking — the confirmed-clock state and Core-to-renderer recheck path are not fully
   specified.** The latest rule itself is clear: the Todo renderer invokes XPC, Main queries both
   SNTP sources concurrently, and an unreachable/failed check neither creates nor clears
   `clock_wrong` nor newly pauses healthy sync (`docs/features/todoist-sync.md:217-235`). But the
   persisted marker's owner/scope is absent even though the clock is device-global and customer
   databases are isolated, and the analysis has no call path for Core `CLOCK_SKEW` to ask the Todo
   renderer to invoke `check`. Task 001 claims a renderer-initiated gate without owning renderer
   paths, while task 002's verification does not explicitly cover a failed/unreachable check from a
   healthy state or the Core-triggered recheck. Specify the device-global marker owner, the typed
   Main→renderer signal/status path, and stale/overlapping check handling; enumerate and test all of
   those integrations. Also replace `:213-214`'s claim that sync runs only while the clock is
   "verified" with the actual rule that only a previously confirmed `clock_wrong` blocks it.

5. **P2 · blocking — permanent-error projection semantics conflict.**
   `docs/features/todoist-sync.md:150-151` protects rows with pending *or failed* commands from orphan
   cleanup, but `:190-191` says a permanent error leaves server state authoritative, and the merge
   matrix at `:195-203` defines overlays only for pending/acknowledged commands. For a permanently
   rejected add/update/delete, an implementation cannot tell whether to keep the optimistic row,
   replay it over remote pages, revert to the canonical row, or hide it while retaining only an
   error record. Define the visible UI/MCP projection and retry/discard behavior for each failed
   command class, then make the permanent-failure test assert that outcome.

## Contract coverage accepted

- Local row changes, ordered outbox entries, and local events share one SQLite transaction, with
  refresh and immediate sync only after commit.
- Phase-one working-set commit, `reconcile_pending` filtering, immediate renderer refresh, later
  historical reconciliation, incremental catch-up, and pending-local orphan protection form a
  coherent two-phase bootstrap.
- Remote pages are baseline-only while local pending commands are replayed in order; an ACK remains
  `acknowledged_waiting_resource` until a matching resource revision arrives, and resource/ACK/token
  application is atomic.
- Client time, device identity, per-device sequence, and command UUID define LWW; `sync_revision` is
  correctly limited to ingestion/delivery ordering rather than conflict victory.
- UI and MCP are specified to use one `TodoistSyncRepository`, and local/remote changes have an
  explicit coalesced `todo/data_updated` refresh requirement.
- The independent `src/main/todoistSync/` and `src/shared/todoistSync/` boundary, PowerSync removal,
  macOS/Windows native SQLite packaging target, and final typecheck/runtime/build evidence are all
  stated; finding 3 concerns where those gates sit in the serial task plan.

## Conclusion

**Blocked.** The anti-overwrite, bootstrap, LWW, and failed-NTP semantics are directionally sound,
but implementation should not begin from this task contract until the migration gate, future-clock
outbox recovery, independently buildable task boundary, clock-state integration, and permanent-error
projection are made deterministic.

## Verification boundary

This was a read-only contract review of the indexed feature, analysis, both Todoist task files, the
Todo MCP contract, the SQLite migration release-gate contract/task, and the current PowerSync call
sites needed to assess task isolation. No product code was edited and no test, typecheck, build,
Electron process, database migration, or network request was run.
