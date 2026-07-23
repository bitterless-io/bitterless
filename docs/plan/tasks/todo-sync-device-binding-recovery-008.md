---
id: todo-sync-device-binding-recovery-008
scope: guarded recovery of stale local Todo device and Snowflake-node bindings
status: implemented; owner verification pending
depends-on: [todo-sync-refresh-identity-004]
verify:
  - existing database identity is classified before any persisted identity write
  - clean stale bindings reset to a full bootstrap without accepting an incremental response
  - every non-terminal outbox state and local-only projection prevents automatic recovery
  - production and DEBUG remain independent devices that can synchronize one customer
  - focused Todo sync tests and type checks pass
---

# Todo sync stale device-binding recovery

## Objective

Allow a clean pre-release DEBUG Todo database left behind by the former changing-device-ID login
flow to recover automatically, while preserving the fail-closed guarantee for any database that
contains unsynchronized local work.

## Context

- `docs/features/todoist-sync.md`
- `docs/issues/todo-sync-device-identity-node-mismatch.md`
- `docs/issues/todo-sync-stale-local-device-binding.md`
- `docs/plan/tasks/todo-sync-refresh-identity-004.md`

## Implementation contract

### Initialization identity gate

- Read the existing `todo_sync_state` row before writing its `device_id`.
- A new database inserts the current identity normally. An existing row with the same identity keeps
  its node and sequence.
- When the stored identity differs, run the clean-state guard before the normal crash recovery that
  returns `in_flight` commands to `pending`.
- The guard requires `rejected_batch_id IS NULL`, no outbox row outside `superseded`/`discarded`,
  and no customer projection with `sync_revision='0'`.
- A clean identity change atomically writes the current identity, resets `device_sequence` to zero,
  clears the cached node and prior error, and resets the sync/bootstrap cursor to `*`.
- A dirty identity change throws the protected identity-mismatch error without changing the state,
  outbox, baseline, or projection rows.

### Legacy overwritten-state gate

- A database already opened by the defective initializer may contain the current `device_id` and an
  older identity's cached node. Detect this only when Core returns a different node.
- Before accepting or applying that response, run the same clean-state guard in a generation-fenced
  write transaction and confirm the cached node has not changed.
- When clean, clear the persisted and in-memory node, reset the cursor to `*`, mark immediate
  bootstrap continuation, and return without applying the incremental response. The existing
  coordinator must immediately request the full working-set bootstrap; the later response installs
  the current device's node through the normal first-sync path.
- Keep `device_sequence` for this same-identity legacy shape. When dirty, retain the existing
  fail-closed behavior and do not mutate sync state.

### Multi-instance boundary

- Production and `debug_prod` keep separate userData roots, installation identities, SQLCipher
  databases, protected keys, and backend Snowflake nodes.
- They do not share a local device identity or local database. Their convergence comes only through
  the existing customer-scoped HTTP sync stream.
- No backend, Bruno, database schema, renderer layout, package, publish, or deployment change is in
  scope.

## Path

- `docs/INDEX.md`
- `docs/features/todoist-sync.md`
- `docs/issues/todo-sync-stale-local-device-binding.md`
- `docs/plan/README.md`
- `docs/plan/tasks/todo-sync-device-binding-recovery-008.md`
- `scripts/todoist-sync/native.test.ts`
- `src/main/todoistSync/todoistSync.repository.ts`
- `src/main/todoistSync/todoistSyncSnowflake.service.ts`

## Verification

- Regression: opening a clean database under a different identity does not retain the old binding;
  it resets to an unassigned node and full bootstrap.
- Regression: a legacy current-identity/old-node database discards the conflicting incremental
  response, then accepts the node only through the next `*` full bootstrap.
- Safety matrix: `pending`, `in_flight`, acknowledgement-waiting, error-waiting, `clock_rejected`,
  `permanent_failed`, and `blocked_by_failed_dependency` each prevent recovery.
- Corruption guard: a non-null rejected-batch marker or any Domain/Todo/SubTodo with
  `sync_revision='0'` prevents recovery.
- Existing same-node first bootstrap, node-conflict protection, encrypted restart, customer
  isolation, pagination, generation fencing, and outbox tests remain green.
- `yarn typecheck:todoist-sync`
- `yarn test:todoist-sync`
- `git diff --check`

## Result

Implemented on 2026-07-23.

- Repository initialization reads and classifies the stored identity inside one transaction before
  any identity or crash-recovery write. Clean identity changes reset the node, cursor, bootstrap
  state, error, and per-identity sequence; dirty changes retain every row and fail closed.
- A legacy current-identity/old-node conflict now runs the same guard before normal node assignment.
  A clean conflict atomically clears the cached node, resets the cursor to `*`, marks immediate
  catch-up, clears the exact expected in-memory node, and returns without applying the conflicting
  response. Dirty conflicts retain the original behavior.
- The guard rejects a non-null rejected-batch marker, every non-terminal outbox state, and local-only
  Domain, Todo, or SubTodo projections. `superseded` and explicitly `discarded` records are the only
  terminal states allowed during recovery.
- Production and DEBUG remain separate devices and local databases; no Core, PostgreSQL, DTO,
  renderer, package, publish, or deployment change was needed.
- `yarn typecheck:todoist-sync`, `yarn test:todoist-sync` (37/37), and `git diff --check` passed.
  Independent review found no remaining P1, P2, or P3 issue after the coordinator-level immediate
  `*` bootstrap regression was added. See
  [`todo-sync-device-binding-recovery-008-1`](../reviews/todo-sync-device-binding-recovery-008-1.md).

Owner verification remains: run production and `yarn dev:prod` together, click Refresh in DEBUG
Todo, and confirm the protected legacy state completes a full bootstrap. A real DEBUG database with
unsynchronized or failed work is expected to remain fail-closed and requires explicit recovery.
