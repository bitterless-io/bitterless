# Todo sync stale local device binding

Status: fixed; owner verification pending

## Classification

This is a Todo synchronization defect in recovery of an existing local database. It is not a
production/DEBUG multi-instance file collision, and it is separate from the fixed login-method
identity bug in [`todo-sync-device-identity-node-mismatch`](todo-sync-device-identity-node-mismatch.md).

## Symptom

Production Bitterless and `yarn dev:prod` can run at the same time, but the DEBUG Todo surface
cannot resume synchronization and reports:

```text
The saved device identity does not match this Todo database. Sync stopped to protect local tasks.
```

The last successful synchronization remains visible while every later cycle fails.

## Root cause

The older DEBUG authentication flow wrote several different installation `device_id` values.
Its customer Todo database therefore retained a Snowflake node assigned to an earlier identity.
The create-once identity fix prevents future identity changes, but intentionally left recovery of
already-mismatched pre-release databases unresolved.

Before this fix, activation compounded the legacy state:

1. The session loads the database's cached `snowflake_node_id`.
2. The former `TodoistSyncRepository.initialize()` implementation unconditionally overwrote the
   persisted `device_id` with the current authenticated identity but left that cached node unchanged.
3. Core returns the immutable node assigned to the current authenticated device.
4. The Snowflake service correctly rejects the different server node, but the original database
   identity has already been overwritten, so subsequent startups cannot classify the stale binding.

The friendly UI message was a translation of that node mismatch; the affected runtime did not
actually compare the stored and current device identities before overwriting the stored value.

## Evidence

- Production and DEBUG use separate `userData` roots, localStorage, customer databases, keys, WAL,
  and SHM files. They are not sharing one SQLite file.
- The DEBUG localStorage journal contains several historical device-identity values, while the
  production journal contains one. Only counts and hashes were inspected; no identity, token, Todo,
  or credential value was exposed.
- The existing issue and task explicitly defer already-mismatched DEBUG database recovery.
- Existing regression coverage proves only that a conflicting node stays fail-closed; it does not
  cover reopening an old database with a new installation identity.

## Fix contract

- Preserve production and DEBUG as independent devices with independent device IDs, Snowflake
  nodes, databases, and keys. Both may synchronize the same customer's cloud Todo data.
- Never overwrite an existing database identity before classifying it.
- Automatically rebind only when one transaction proves there is no recoverable local work:
  `rejected_batch_id` is absent; every outbox row is terminal `superseded` or `discarded`; and no
  Domain, Todo, or SubTodo has `sync_revision='0'`.
- For a clean stale binding, atomically bind the current identity, clear the cached node, reset the
  customer-bound token to `*`, and perform a working-set-first full bootstrap. Reset the device
  sequence only when the stored identity actually changes.
- Also recover the legacy poisoned shape where the stored identity was already overwritten but the
  cached node still differs: discard that one incremental response, perform the same clean-state
  guard, clear the node, and immediately bootstrap from `*`.
- If any pending, in-flight, acknowledgement-waiting, clock-rejected, permanently failed, blocked,
  or local-only work exists, retain every row and stay fail-closed. Never accept a new node merely
  to hide the error.
- No Core API, PostgreSQL schema, or sync wire-contract change is required.

## Resolution

Implemented on 2026-07-23 in
[`todo-sync-device-binding-recovery-008`](../plan/tasks/todo-sync-device-binding-recovery-008.md).

Initialization now classifies the persisted identity before changing it. The legacy poisoned shape
is recovered at response time only after the complete clean-state guard passes; the conflicting
response is discarded, the cursor becomes `*`, and the existing coordinator immediately runs a
full bootstrap. Dirty databases retain their state and the original protection error.

Independent verification found no P1, P2, or P3 issue. The strict type check and 37/37 native
Todoist Sync tests passed, including the complete blocker matrix, generation fencing, and a
coordinator-level proof of the immediate `*` retry. Production plus `dev:prod` live verification is
left to the owner because this task did not start Electron or mutate the running DEBUG database.
