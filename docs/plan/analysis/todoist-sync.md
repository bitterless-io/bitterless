# Todoist-style Todo sync delivery analysis

## Module decomposition

| module | input | output | dependencies |
|---|---|---|---|
| `todoistSync.database` | customer ID, injected/runtime password | encrypted schema-v1 manifest | cipher SQLite |
| `todoistSync.repository` | UI/MCP commands and remote pages | baseline + visible projection + outbox | database, Snowflake IDs |
| `todoistSync.client` | Core token, token, command batch | strict sync response | HTTP `/todo/sync` |
| `todoistSync.coordinator` | triggers, outbox, token | serialized push/pull/reconcile | client, repository |
| `todoistSync.clock` | renderer check request | device-global successful sample/marker | parallel SNTP, atomic userData state |
| `todoistSync.session` | customer/device/Core token | active isolated runtime + generation | key service, coordinator |
| XPC/UI/MCP integration | existing Todo operations | shared projections, status, refresh | active session |

All protocol/storage implementation is contained by `src/main/todoistSync/` and
`src/shared/todoistSync/`. The renderer owns check cadence and presentation, not UDP or persistence.
The old `src/main/todoSync/` PowerSync implementation is removed rather than retained as a
compatibility layer.

The database factory has two explicit password providers. Production Electron uses a generated
password wrapped by `safeStorage`; every automated/local test injects a fixed password and asserts
that `safeStorage`/OS credential APIs were never called. Todo sync is unreleased, so schema v1 is a
new database with no fabricated legacy upgrade or `main.db` import. Its ordered runtime manifest is
also consumed by the SQLite release audit for fresh create, current-v1 reopen, failure rollback, and
integrity checks.

## Repository state and remote monotonicity

The repository keeps the server's canonical baseline distinct from the materialized resource rows
queried by UI/MCP. It then overlays active local commands in durable order. This separation is what
makes rollback, ACK waiting, and stale-page rejection deterministic.

```text
remote row R compared with stored baseline B
  R.revision > B.revision  → replace B; presence may clear reconcile/ACK markers
  R.revision = B.revision  → retain B fields; presence may clear reconcile/ACK markers
  R.revision < B.revision  → ignore everything, including presence side effects
  then replay active overlays to rebuild the visible row
```

Equal-revision canonical payload disagreement rejects the page as a protocol error. Missing rows
never imply deletion/completion/archive. A reconciliation marker left after the server finishes is
preserved and hidden with a sync-integrity diagnostic; no orphan cleanup mutates it.

The active outbox transitions are:

```text
pending → in_flight → acknowledged_waiting_resource → removed after resource proof
                    ↘ error_waiting_resource → permanent_failed after canonical proof
                    ↘ permanent_failed immediately when canonical revision/reference are null
                       → retry(new UUID/version) | discard
in_flight batch → HTTP CLOCK_SKEW → exact UUID set clock_rejected
failed missing add → dependent operations blocked_by_failed_dependency
```

`pending`, `in_flight`, `acknowledged_waiting_resource`, `error_waiting_resource`, and
`clock_rejected` participate in the optimistic projection. A non-null permanent-error canonical
revision/reference keeps the rejected overlay pull-only until that row proves the revision; only
then does it become non-projecting `permanent_failed`. Null projection fields roll back immediately
to `permanent_failed`. Dependency failures do not project. Retry creates a new UUID, timestamp,
sequence, and base revision; discard changes only terminal diagnostics. After canonical proof or an
immediate null-projection rollback, failed add/update/delete respectively hide the unaccepted new
row, restore rejected fields, or restore the rejected live row, then replay later eligible overlays.

## Integration enumeration

```text
AuthStore activates TodoistSyncHandler
  → session opens encrypted customer database
  → coordinator posts `*` or cached sync_token
  → working set commits and broadcasts refresh
  → reconcile pages populate Completed/archive/tombstones

UI or MCP mutation
  → one repository transaction updates projection + outbox + local event
  → local broadcast refreshes Todo immediately
  → coordinator sends an exact ordered in-flight batch
  → response updates monotonic baselines + ACK states + token atomically
  → only ACKs with canonical resource proof leave the outbox
  → active commands replay and one coalesced remote refresh broadcasts
```

Tests use the real repository/coordinator boundary. Mock-only XPC tests do not prove outbox
atomicity, priority bootstrap, pending replay, remote deletion events, or account isolation.

## Clock request and recovery path

```text
Todo renderer mount/focus/15-minute cadence
  → TodoistSyncClockHandler.check(session_generation, request_generation)
  → Main validates generations and starts both SNTP requests concurrently
  → only the latest accepted successful result may atomically replace userData clock-state.json

Core HTTP CLOCK_SKEW
  → exact in-flight UUID set becomes clock_rejected; no command receipt exists
  → Main broadcasts clock-check-requested(session_generation, request_generation)
  → active Todo renderer invokes the same XPC check
  → healthy result atomically re-identifies only future-dated members, then resumes upload
```

The clock record is Main-owned and device-global; customer databases never duplicate it. A stale
renderer/session/check generation cannot persist evidence, recover an outbox, or resume a
coordinator. Unreachable NTP leaves prior state unchanged. With no previously confirmed wrong
sample, it causes no marker, banner, or global pause. A quarantined CLOCK_SKEW batch remains excluded
from upload while pull-only cycles continue. A successful wrong sample creates `clock_wrong` and
globally pauses; only a later successful healthy sample clears it.

Healthy recovery handles the exact rejected batch in one customer-SQLite transaction. It preserves
non-future offline versions/UUIDs and assigns each proven future command a new UUID,
`client_updated_at = Date.now()`, and next device sequence in original order. Commands outside the
no-receipt set are never rewritten. If healthy trusted time does not explain Core's rejection, the
batch remains quarantined as a server-clock contract error.

## Task boundary

`todoist-sync-desktop-001` owns the module and the complete cutover: auth, UI, MCP, refresh,
settings, renderer-triggered clock flow, release-migration manifest/audit integration, dependency
removal, runtime assets, native cipher smoke, type checks, and Electron build. Splitting those call
sites from module deletion would create an uncompilable intermediate tree, so there is one
independently verifiable desktop task.

The already-present Core/Maestro migration runner and audit hook are its foundation. This task is
the only owner of the new Todo manifest/fixtures and registers them into that hook. The final
`sqlite-migration-release-gate-001` task depends on this one and consumes the result for the
three-family production audit, so the two tasks never modify the same deliverable concurrently.
Local strict fixtures allow desktop work to begin, but completion additionally waits for the
`bitterless-private` backend implementation/integration tasks and a real non-production two-client
HTTP smoke.

## Explicit non-goals

- importing legacy `main.db` Todo rows;
- realtime push, WebSocket, PostgreSQL logical replication, or PowerSync;
- cloning Todoist resource vocabulary or connecting to Todoist accounts;
- resolving simultaneous edits beyond client-time LWW with deterministic device/UUID ties and
  permanent tombstones.
