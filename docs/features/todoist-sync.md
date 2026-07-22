# Todoist-style Todo synchronization

## Purpose

Bitterless Todo is a personal, multi-device-synchronized Todo application. It uses an
application-owned HTTP synchronization protocol shaped after Todoist's first-party Sync API:
clients submit ordered commands and an opaque `sync_token`, then receive command acknowledgements
and the current rows changed after that token.

This is not a Todoist integration and sends no data to Todoist. It has no PowerSync runtime,
logical-WAL dependency, Docker service, or server-side `todo_message` operation log.

## Independent module boundary

Todoist-style synchronization is isolated from generic Todo UI and MCP code:

```text
src/main/todoistSync/
  encrypted SQLite, local repository, outbox, HTTP client, coordinator, session

src/shared/todoistSync/
  wire contracts and session/status types

src/main/xpc/todoistSync.handler.ts
  renderer-facing lifecycle/status boundary

scripts/todoist-sync/
  storage, protocol, scheduling, integration, and packaging tests
```

No new file or exported symbol may retain `PowerSync` naming. UI and MCP consume the same
`TodoistSyncRepository`; neither knows the HTTP protocol or writes the legacy Todo tables.

## Storage boundary

```text
existing userData/db/main.db
  legacy Todo rows and other Bitterless data (ignored: never opened, imported, migrated, or deleted)

new userData/db/todoist-sync-v1/customer-<customerId>.db
  todo_domains / todos / sub_todos
  canonical remote baselines for each synchronized resource
  todo_sync_outbox / todo_sync_state
  local-only todo_events
```

- The new database is encrypted through `better-sqlite3-multiple-ciphers`.
- Its random key is protected by Electron `safeStorage` beside the database.
- The database path must never equal or share the file name of `main.db`.
- Each customer has a separate database and key. Logout closes it; account switch opens another.
- Existing legacy Todo rows are irrelevant. This is an intentional new database and clean remote
  bootstrap; no compatibility import or old-Todo migration is implemented.
- The original schema-v1 became observable in DEBUG before the parent-order fix. It is immutable.
  Ordered schema-v2 adds the nullable canonical-baseline parent reference and its lookup index while
  preserving every v1 row. The upgrader also accepts development v1-ledger databases that already
  contain those two objects. The release migration audit covers fresh creation, both v1 upgrade
  shapes, current-v2 reopen/idempotence, failed migration rollback, and integrity checks.
- Real Electron runtime creates a random database password and protects it with `safeStorage`.
  Automated/local tests inject a fixed test password through the database factory and must fail if
  any Keychain, Credential Manager, or `safeStorage` API is touched; this keeps tests deterministic
  and non-interactive while exercising the same encrypted schema and repository.
- Synchronized IDs are fixed-width 20-character decimal Snowflake strings. The backend assigns a
  stable node `0..1023` per customer/device. A cached node permits later offline creation.

Local resource rows additionally keep:

| field | purpose |
|---|---|
| `sync_revision` | last server revision as a decimal string; `"0"` means never acknowledged |
| `client_updated_at` | raw local system Unix milliseconds and cross-device LWW version |
| `deleted_flag` / `deleted_at` | durable tombstone; rows are not physically deleted |
| `reconcile_pending` | server-known cached row absent from the priority working-set snapshot |

The canonical remote baseline is stored separately from the optimistic visible projection. A
remote page therefore never needs to overwrite local fields before outbox overlays can be replayed.
Wire resources omit legacy compatibility fields: the repository projects
`updated_at = client_updated_at` and `is_deleted = deleted_flag === "" ? 0 : 1` for existing UI/MCP
types.
For each resource, its baseline revision is monotonic:

| incoming revision | baseline action | other permitted effects |
|---|---|---|
| greater than the stored revision | replace the canonical baseline and advance its revision | clear `reconcile_pending`; prove a waiting ACK at or below this revision |
| equal to the stored revision | do not replace canonical fields | presence may clear `reconcile_pending` and may prove a waiting ACK at or below this revision |
| lower than the stored revision | ignore the row completely | it cannot clear reconciliation state or prove an ACK |

After baseline processing, active outbox overlays are replayed in order to materialize the visible
resource rows used by UI and MCP. A same-revision payload whose canonical fields disagree with the
stored baseline is a protocol error; the page and its token are not committed.

## Wire contract

The main process calls the Core endpoint `POST /todo/sync` with the existing `-x-bl-token`.

```json
{
  "sync_token": "*",
  "commands": [
    {
      "uuid": "d0a1666b-d615-4250-aac5-65c7ea89091a",
      "type": "todo_add",
      "args": {
        "id": "00337745490739269633",
        "domain_id": "00337745490739269632",
        "title": "Example",
        "client_updated_at": 1784592000000,
        "client_sequence": 1,
        "base_revision": "0"
      }
    }
  ]
}
```

- `sync_token = "*"` requests a bootstrap.
- Later requests send the last opaque token exactly as returned.
- At most 100 commands are sent per request, in local outbox order.
- Supported commands are `domain_add|update|delete`, `todo_add|update|delete`, and
  `sub_todo_add|update|delete`. An update carries only changed mutable fields; reorder, completion,
  archive, importance, movement, repeat, and reminder behavior use typed update commands.
- Every command has a UUIDv4 distinct from its final 20-digit resource ID. The UUID is stable
  across retries. No temporary-ID mapping exists.

```json
{
  "sync_token": "opaque-customer-bound-token",
  "full_sync": true,
  "sync_phase": "working_set",
  "has_more": true,
  "server_time_ms": 1784592000123,
  "snowflake_node_id": 17,
  "sync_status": {
    "d0a1666b-d615-4250-aac5-65c7ea89091a": {
      "status": "ok",
      "applied": true,
      "sync_revision": "42",
      "canonical_resource": {
        "resource_type": "todo",
        "id": "00337745490739269633"
      }
    }
  },
  "todo_domains": [],
  "todos": [],
  "sub_todos": []
}
```

Every HTTP 200 includes `server_time_ms`, `snowflake_node_id`, all three resource arrays, and one
status per submitted UUID. An OK status is exactly
`{ status, applied, sync_revision, canonical_resource: { resource_type, id } }`. A permanent status
is exactly `{ status: "error", error_code, error, sync_revision, canonical_resource }`, where the
last two fields are both non-null or both null. A non-null canonical value is a reference, never an
embedded snapshot. `applied = false` means the server retained a newer client-time version and
stamped the canonical row with a new delivery revision so it will be echoed to the client.
HTTP/network/503 failures are transient and leave commands pending. The strict parser also accepts
only the documented request-level 400/409/503 envelopes and fails on unknown phases, variants,
malformed IDs, unsafe numbers, or absent required fields. The backend contract is the exhaustive
source for nine command/resource field allowlists and phase combinations.

## Bootstrap and Todo UI experience

Bootstrap is deliberately two-phase so the current work appears before completed/deleted history:

```text
successful `*` request
  ├─ push pending commands first
  ├─ phase 1: working_set pages at server revision H (500 total resources/page)
  │    live + unarchived Domains
  │    live + incomplete Todos in those Domains
  │    all live SubTodos belonging to those incomplete Todos
  └─ phase 2: reconcile pages up to H
       every current Domain/Todo/SubTodo row, including completed, archived, and tombstones
```

All live SubTodos under an incomplete Todo are included in phase 1, even completed SubTodos, so
opening an active Todo never shows an incomplete checklist. Working-set pages use their dedicated
`(resource_rank, id)` cursor so Domains arrive before Todos and Todos before SubTodos. Reconcile and
incremental pages instead use `(sync_revision, resource_rank, id)` as defined by Core.

When phase 1 commits locally:

1. Existing server-known rows (`sync_revision != "0"`) are marked `reconcile_pending = 1`.
2. Working-set rows are authoritatively upserted and clear that marker.
3. Pending local commands are replayed after the remote apply and are never hidden or discarded.
4. All Todo queries exclude `reconcile_pending = 1`, so stale cached work disappears from the
   active view without being misclassified as deleted or completed.
5. The renderer refreshes immediately. Reconciliation continues without blocking the active UI.

Reconcile pages clear the marker and apply the real state: completed Todos move to Completed,
archived Domains move to the archive surface, and tombstones disappear from live queries. After
reconciliation the coordinator performs one immediate incremental catch-up for changes after H.
Absence from a page, working set, or completed reconciliation is never interpreted as completion,
archive, or deletion. The client performs no orphan tombstoning: only an explicit canonical remote
row/tombstone may change business state. Any baseline still carrying `reconcile_pending` after the
server declares reconciliation complete remains hidden, is preserved for diagnosis, and produces a
sync-integrity error without advancing cleanup state.

Offline startup with an existing customer database renders the last reconciled state immediately.
A first-ever device without a cached Snowflake node requires one successful sync before it may
create offline rows. Sync failure must never invalidate an otherwise valid Core login.

## Local mutation and conflict contract

Every UI or MCP mutation executes one encrypted SQLite transaction:

```text
validate business rule
  → update/soft-delete current row(s)
  → append ordered UUID command(s) to todo_sync_outbox
  → append local todo_events when applicable
  → commit
  → broadcast todo/data_updated
  → request an immediate sync cycle
```

- Local state is optimistic and survives restart.
- Each mutation sets `client_updated_at = Date.now()`, increments a persistent per-device
  `client_sequence`, and puts both values plus the row's current `base_revision` in the command.
  Unix milliseconds are timezone independent. The server compares
  `(client_updated_at, device_id, client_sequence, command_uuid)` lexicographically; this client
  version decides cross-device last-write-wins. The sequence only makes same-device/same-millisecond
  commands deterministic; it does not hide a wrong or rolled-back system clock.
- `sync_revision` does not decide conflict winners. It is a server-ingestion/delivery cursor needed
  so a late-uploaded offline edit with an old client timestamp is still delivered to devices whose
  sync token has already advanced past that timestamp.
- Remote apply never creates an outbox command.
- After every remote page, still-pending local commands are replayed in outbox order so an older
  server state cannot visually overwrite an unsent local edit.
- Add/update/delete first participate in the same client-version comparison. A stale offline delete
  loses to a newer live version and the canonical live row is echoed. Once a newer delete creates a
  tombstone, that tombstone wins forever; later updates never resurrect the ID.
- Applying remote Todo changes compares prior/current state and appends the corresponding local
  `todo_events` entry with actor `system`; this keeps MCP status/event reads aware of remote
  completion, movement, updates, and deletion.
- A permanent command error is never retried automatically. With a non-null canonical reference it
  first becomes a non-sendable error overlay waiting for that resource revision; with null
  projection fields it rolls back immediately. In either case the terminal failed record retains
  its exact payload for explicit retry/discard after the rejected overlay has been removed.

### Outbox state machine

| state | sent automatically | participates in projection | transition |
|---|---|---|---|
| `pending` | yes | yes | marked `in_flight` with an exact request/batch ID before HTTP starts |
| `in_flight` | already sent | yes | transient/lost response returns it to `pending` with the same UUID; startup does the same |
| `acknowledged_waiting_resource` | no | yes | stores `ack_revision` and waits for canonical presence at that revision or later |
| `error_waiting_resource` | no | yes | permanent error with non-null revision/reference; pull-only until that exact canonical proof arrives |
| `clock_rejected` | no | yes | exact member of a whole batch rejected with HTTP `CLOCK_SKEW`; recovered only after a successful healthy renderer-triggered clock check |
| `permanent_failed` | no | no | retained for explicit retry or discard |
| `blocked_by_failed_dependency` | no | no | retained until its failed missing ancestor/add is retried successfully or it is discarded |
| `superseded` / `discarded` | no | no | terminal diagnostic record, eligible for bounded history pruning |

An OK ACK, including `applied = false`, moves only its matching UUID to
`acknowledged_waiting_resource`. The UUID and optimistic overlay remain until a non-stale canonical
row for the same entity proves `sync_revision >= ack_revision`. That proof removes the acknowledged
command, then the repository recomputes the projection from the monotonic baseline plus any newer
active commands. An ACK without resource proof never removes an overlay. Resource rows, ACK state,
token/page state, and projection replay for one response commit in one SQLite transaction.

Permanent errors have command-specific rollback semantics. An error with non-null
`sync_revision`/`canonical_resource` enters `error_waiting_resource`; it keeps the overlay while
pull-only sync obtains the referenced row at or after that revision. Only then is its overlay
removed and its diagnostic state changed to `permanent_failed`. An error whose two projection
fields are null becomes `permanent_failed` and rolls back immediately:

- failed add: remove the add overlay. With no canonical baseline the entity disappears from normal
  UI/MCP queries. Pending update/delete commands for that missing entity, and child adds whose parent
  exists only through the failed add, become `blocked_by_failed_dependency` and do not project;
- failed update: restore the rejected fields from the canonical baseline, then replay later eligible
  commands in their original order;
- failed delete: remove the rejected tombstone overlay so the canonical live row returns, then
  replay later eligible commands.

Explicit **Retry** revalidates the retained payload against the current canonical projection,
marks the failed record `superseded`, and enqueues a new command with a new UUID, current
`client_updated_at`, next device sequence, and current `base_revision`. A failed add keeps its
20-digit resource ID when still valid; a parent must be retried before blocked descendants. Explicit
**Discard** marks the error `discarded` and changes no resource because rollback already happened.
Neither action silently retries or discards a dependent command.

### Anti-overwrite merge matrix

| local entity state | incoming remote row | required result |
|---|---|---|
| one or more active overlay commands | any non-stale revision | update/presence-check only the remote baseline, then replay active commands, including ACK/error-wait overlays; visible local state must not regress |
| matching command ACK, but a newer command remains | canonical presence at/after ACK | remove only the proven acknowledged command, apply the monotonic baseline, then replay newer commands |
| matching command ACK, no newer command | canonical presence at/after ACK | remove the proven command and materialize the canonical baseline |
| no active overlay | revision greater than baseline revision | replace baseline and projection |
| no active overlay | revision equal to baseline revision | retain canonical fields; presence may clear reconciliation and prove an ACK |
| any state | revision lower than baseline revision | ignore completely; do not clear markers or ACKs |
| pending delete loses client-version comparison | canonical live row at ACK revision | remove the acknowledged delete only after that row arrives; restore the canonical live projection |
| accepted tombstone | later non-delete update | keep deleted; no resurrection |

Older remote pages therefore cannot clear an optimistic overlay, a reconciliation marker, a
waiting ACK, or a permanent-error overlay awaiting canonical proof. A lost HTTP response retries
the same UUID; the server returns the same receipt and the merge remains idempotent.

## Clock trust gate

Client time is authoritative for conflict order. Synchronization runs by default and is globally
paused only when at least one successful trusted-time sample has confirmed `clock_wrong`.

```text
Todo renderer store (mount / focus / every 15 minutes)
  → calls TodoistSyncClockHandler.check through electron-xpc with active session/request generations
  → Main queries SNTP sources concurrently (`ntp.aliyun.com`, `time.cloudflare.com`)
  → no successful source: return unreachable; persist nothing and create/clear no marker
  → successful sample and |offset| <= 180 seconds: atomically persist healthy state, clear clock_wrong
  → successful sample and |offset| > 180 seconds: atomically persist clock_wrong, pause upload/download
```

- The renderer owns when checks happen and owns UI state. UDP/123 remains in the main-process
  `src/main/todoistSync/` clock service because the sandboxed renderer has no Node socket access.
- Main owns the device-global clock record at
  `userData/todoist-sync/clock-state.json`; it is not stored in a customer database. A successful
  sample is written through a same-directory temporary file, file sync, and atomic rename. The
  record contains status, local/trusted sample times, signed offset, last-success time, and a
  monotonic check generation. An unreachable check leaves the complete prior record unchanged.
- Successful sources are combined deterministically; network-delay-corrected offset and sample time
  are returned. The service never changes the OS clock.
- Inaccessibility is not a clock error. If no prior confirmed marker exists, sync continues and no
  warning appears. If `clock_wrong` was already confirmed, an unreachable retry does not erase that
  evidence; only a later successful healthy sample clears it.
- Overlapping checks are generation fenced. Each accepted renderer request carries the active
  Todoist session generation and a renderer request generation; Main validates both before the
  query and again before committing its result. A newer accepted check supersedes an older one, so
  stale results cannot create/clear the marker, recover an old customer's outbox, or resume a stale
  coordinator.
- Before applying a batch, Core rejects the whole request when any command time is more than 180
  seconds in the future. It applies no command and writes no UUID receipt. Past timestamps remain
  valid for genuine long-offline edits. A Core `CLOCK_SKEW` result cannot itself create
  `clock_wrong`. Main atomically changes the exact ordered UUID set from that submitted `in_flight`
  batch to `clock_rejected`, persists the rejected batch ID, and broadcasts a typed
  `todoist-sync/clock-check-requested` event containing the current session and request generations.
  The active Todo renderer ignores stale generations and initiates the XPC check.

`CLOCK_SKEW` is a transient no-receipt batch outcome, not proof that the device clock is wrong.
While its exact batch is quarantined, pull-only sync may continue and no clock banner is created.
An unreachable clock check leaves that batch quarantined and does not globally pause synchronization.
After a successful healthy check, one customer-SQLite transaction recovers the exact rejected set:

1. Verify every UUID belongs to the persisted rejected batch and still has the no-receipt
   `clock_rejected` state. Commands outside that exact set are never re-identified.
2. Compare each command with the trusted sample. For each timestamp more than 180 seconds ahead,
   mark its old record `superseded`, clone it with a new UUID, corrected `Date.now()` timestamp, and
   the next persistent device sequence, preserving command order. Rebuild affected resource
   projections from the baseline plus the replacements.
3. Return non-future members to `pending` with their original UUID/version, clear the rejected batch
   marker, commit, and request an immediate upload.

The operation is all-or-nothing and safe only because Core guarantees that exact rejected batch was
prevalidated before any command or receipt. If a successful healthy NTP sample shows none of the
rejected commands was future-dated, the client keeps the batch quarantined and reports a Core-clock
contract error instead of rewriting valid offline versions. A crash between the atomically written
device clock record and customer-database recovery leaves `clock_rejected` intact; the next
renderer-triggered successful check repeats the idempotent recovery.

The Todo surface exposes one Arco/BEM/i18n banner only for confirmed `clock_wrong`. It shows local
time, trusted time, signed offset, last successful check, and an action that opens macOS or Windows
Date & Time settings. It explains that synchronization is paused while local data/outbox remains
safe. When a later successful check is healthy, the banner clears and the coordinator resumes.

## Coordinator lifecycle

Exactly one coordinator exists for the active customer. It guarantees one in-flight HTTP request.

Immediate triggers:

- authenticated session activation;
- successful UI or MCP local mutation;
- network recovery and a confirmed clock gate returning to healthy;
- an immediate continuation while outbox or response pages remain.

Every trigger is blocked only by a confirmed `clock_wrong`; absence/unreachability alone is not a
blocker. After a successful, fully drained cycle, the next regular sync is scheduled from completion time.
The customer setting is clamped to `10..180` seconds. Transient failures retain the outbox and use
bounded backoff up to 180 seconds. An immediate trigger during a request sets one rerun flag rather
than starting a concurrent request.

An invalid/version-mismatched token is reported, then permits exactly one controlled `*` bootstrap
that preserves and replays the local outbox. Repeated failure stays visible and must not loop.

Logout/auth invalidation increments the session generation, aborts HTTP, stops timers, closes the
database, and prevents stale responses from applying. Account switching never mixes rows or keys.

Authentication may start Todo synchronization as optional background work so it cannot delay a
valid Core login. Home retains that activation request per authenticated customer. Embedded and
standalone Todo entry points await it before creating the Todo renderer and retry a failed request
when the user opens Todo again. Required renderer XPC values are validated: a transport `null` is a
runtime failure, never an empty list or the Domain-capacity result.

## Packaging and removal

- Retain exact `better-sqlite3-multiple-ciphers` and `@sapphire/snowflake` dependencies.
- Remove `@powersync/node`, its worker entry, worker/native-extension asset configuration, all
  PowerSync connector/schema/session symbols, and PowerSync-specific tests.
- Bundle the existing SQLite cipher native module for macOS and Windows through the normal Electron
  path. Development and packaged builds must resolve the same new database implementation.
- Runtime and the release audit consume one ordered Todo v1-to-v2 manifest. Native/runtime smoke
  uses the injected fixed test password and must not touch `safeStorage`; only the real application
  password provider may call `safeStorage`.

## Verification

Required evidence:

- fixed-password encrypted create/reopen and wrong-password failure, with a tripwire proving tests
  never access `safeStorage`/OS credentials and the Todo module never opens legacy `main.db`;
- schema-v1 pre-parent-reference upgrade, already-shaped v1-ledger upgrade, current-v2 reopen,
  failed migration rollback, `integrity_check`, and `foreign_key_check`;
- resource CRUD, repeat/complete, reorder, archive/restore, cascade tombstones, and local events;
- mutation + outbox atomicity across thrown errors and restart;
- every outbox transition, lost-response UUID retry, exact ACK/resource proof, permanent add/update/
  delete rollback, explicit new-UUID retry/discard, pending replay, and token reset;
- monotonic baselines: greater replaces, equal proves presence without field replacement, lower has
  no marker/ACK effects, and page absence never triggers orphan cleanup;
- client-time LWW ordering, deterministic same-millisecond tie-breaking, late offline upload delivery,
  and ACK-waits-for-resource anti-overwrite behavior;
- renderer-initiated parallel SNTP healthy/skewed/unreachable states, 180-second boundary, failed
  checks not creating/clearing markers, device-global atomic persistence, stale generation fences,
  typed Core-to-renderer recheck, paused outbox preservation, and Date & Time settings action;
- exact future-time rejected-batch persistence and later healthy recovery with new UUID/timestamp/
  sequence only for proven future members; pull-only progress while NTP remains unreachable;
- phase-1 working-set priority followed by completed/archive/tombstone reconciliation;
- no active-item flicker from stale rows and no inferred orphan cleanup of any local state;
- two customer-scoped databases, logout/account-switch generation fencing;
- UI and MCP sharing one repository and receiving local/remote coalesced refresh;
- configured 10/180-second bounds, completion-relative scheduling, non-overlap, and immediate MCP
  trigger;
- node/mcp/web type checks, Todo/MCP tests, runtime asset check, and full Electron build.

## References

- [Todoist API v1 Sync endpoint](https://developer.todoist.com/api/v1/) — first-party
  `sync_token`, incremental resource reads, ordered batched commands, UUID acknowledgements, and
  full-sync semantics used as the protocol shape reference.
- [Aliyun public NTP service](https://developer.alibaba.com/docs/doc.htm?articleId=112525&docType=1)
  — documents `ntp.aliyun.com` as a public NTP endpoint.
- [Cloudflare Time Service](https://developers.cloudflare.com/time-services/ntp/usage/) — documents
  `time.cloudflare.com` as a public NTP endpoint.
