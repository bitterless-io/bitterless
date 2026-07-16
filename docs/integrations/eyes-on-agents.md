# EyesOnAgents Integration

Status: implemented and independently verified

Date: 2026-07-16

Verified: 2026-07-16

## Decision

Replace the provider-neutral Coding-agent Sessions page with **EyesOnAgents**, a Codex-only Mini
App that opens in its own Bitterless window. EyesOnAgents is an observation board: it discovers
Codex threads, groups them into user-managed Domains, shows work that needs attention in a derived
Focus column, and opens an exact task in Codex Desktop.

Claude support is removed from the active product, runtime, UI, tests, and setup flows. Historical
Claude rows may remain in the legacy SQLite table so the migration is non-destructive, but
EyesOnAgents never reads or displays them.

## Goals

- Connect to a Bitterless-managed local Codex App Server and keep that connection alive while the
  application is running.
- Import Codex threads into a dedicated, display-oriented SQLite model.
- Put every newly discovered thread into the system `Uncategorized` Domain until the user moves it.
- Show running threads and newly completed unread threads in a fixed Focus column.
- Persist Domain assignment and the last thread opened through EyesOnAgents across restarts.
- Open the exact Codex Desktop task with `codex://threads/<thread-id>`.
- Supplement managed App Server events with the existing opt-in Codex Desktop hook bridge, while
  making the evidence source visible and bounded.
- Support macOS and Windows through the existing Electron/XPC architecture.

## Non-goals

- Claude Code, Claude Desktop, `claude agents --json`, or Claude hook support.
- Reading prompts, transcripts, tool calls, diffs, or model output.
- Sending prompts, steering an active turn, or implementing a client-side message queue in this
  delivery. The persistent App Server client is the foundation for a later composer.
- Attaching to the private stdio child process owned by Codex Desktop.
- Treating a second App Server process as proof of Codex Desktop's in-memory state.
- Reimplementing the Codex conversation interface inside Bitterless.

## Product boundary

EyesOnAgents receives two kinds of evidence and keeps them distinct:

```text
Codex thread store
      |
      v
Bitterless-managed `codex app-server --stdio`
      |  thread/list + lifecycle notifications for work owned by this server
      v
EyesOnAgents service ------------------------------------+
      ^                                                   |
      |  lifecycle metadata only                          v
opt-in Codex Desktop hooks -> local bridge       SQLite + XPC broadcast
                                                          |
                                                          v
                                                EyesOnAgents window
```

The managed App Server is authoritative only for threads and turns loaded or started through that
same server instance. Codex Desktop currently owns a separate private stdio App Server and exposes
no supported external attach endpoint. A managed connection can list the shared thread store, but
it must not reinterpret `notLoaded` as idle or completed.

The Codex hook bridge is therefore retained as a separate, optional Desktop observation source. It
can report lifecycle transitions for Desktop/CLI work after installation, but it does not provide
transcripts and cannot prove every possible waiting state. Stale or contradictory evidence becomes
`unknown`.

## App Server connection lifecycle

The main process owns one connection supervisor for the entire Bitterless process:

1. `Connect` resolves the installed Codex executable and starts `codex app-server --stdio` without
   a shell.
2. The client completes the JSON-RPC initialize handshake before reporting `connected`.
3. It pages through `thread/list`, upserts Codex metadata, and leaves the child process running.
4. Notifications such as `thread/status/changed`, `turn/started`, and `turn/completed` update the
   repository and broadcast a compact change event to EyesOnAgents renderers.
5. Unexpected process exit changes the connection to `error`; it never fabricates thread state.
6. `Disconnect`, sign-out, or application shutdown terminates only the App Server process owned by
   Bitterless.

A successful explicit connection enables auto-connect for later Bitterless launches. Explicit
disconnect disables auto-connect. Connection preference belongs in the existing setting store;
thread and Domain state belongs in the dedicated tables below.

The renderer can request only `connect`, `disconnect`, `sync`, and status inspection. It cannot
provide an executable, command arguments, URL, or arbitrary JSON-RPC method.

## Domain model

EyesOnAgents uses dedicated tables rather than Todo's `domain` and `todo` tables. The two products
must not share ordering, archive, or deletion semantics.

### `eyes_on_agents_domain`

| column | meaning |
|---|---|
| `id` | integer primary key |
| `domain_key` | stable unique key; `uncategorized` is reserved |
| `title` | user-visible title |
| `sort_index` | horizontal board order for real Domains |
| `is_system` | system Domains cannot be renamed or deleted |
| `is_deleted` | soft-delete flag |
| `delete_flag` | active value `0`; deletion timestamp string for unique-key reuse |
| `deleted_at` | soft-delete time |
| `created_at`, `updated_at` | lifecycle timestamps |

`Uncategorized` is inserted idempotently during SQLite bootstrap with `is_system = true` and the
first real-column sort position. Focus is not stored in this table.

### `eyes_on_agents_thread`

| column | meaning |
|---|---|
| `thread_id` | validated Codex UUID primary key |
| `domain_id` | non-null reference to an active EyesOnAgents Domain |
| `title` | Codex name/preview fallback, display only |
| `cwd` | working directory when Codex exposes it |
| `runtime_state` | normalized status enum |
| `active_flags_json` | App Server active flags, never transcript content |
| `active_turn_id` | currently observed turn when known |
| `last_completed_turn_id` | most recently observed terminal turn when known |
| `last_completed_at` | most recent observed terminal time |
| `last_opened_turn_id` | terminal/active turn seen when opened through EyesOnAgents |
| `last_opened_at` | successful Codex deep-link open time |
| `status_source` | `app_server`, `codex_hook`, or `discovery` |
| `status_observed_at` | freshness boundary for runtime evidence |
| `last_activity_at` | sort/display timestamp from reliable metadata or events |
| `created_at`, `updated_at` | local lifecycle timestamps |

Initial migration imports only active Codex rows from the legacy `coding_agent_session` table.
Imported and newly discovered rows are assigned to `Uncategorized`; subsequent syncs preserve an
existing Domain assignment. Historical import does not synthesize a completion marker, so old
threads do not flood Focus as unread.

Deleting a custom Domain soft-deletes it and moves all of its threads to `Uncategorized` in one
transaction. The system Domain cannot be renamed or deleted.

## Runtime state

```ts
type EyesOnAgentsRuntimeState =
  | "working"
  | "waiting_approval"
  | "waiting_input"
  | "idle"
  | "failed"
  | "ended"
  | "unknown";

type EyesOnAgentsStatusSource =
  | "app_server"
  | "codex_hook"
  | "discovery";
```

App Server active flags map approval/input waits ahead of generic working. `notLoaded` maps to
`unknown`, not idle. A terminal turn notification records completion independently from the
thread's resulting idle state.

Hook evidence may temporarily override discovery evidence when it is newer. App Server lifecycle
events from the managed connection are authoritative for that connection. Evidence past the
existing freshness boundary becomes `unknown` while the durable completion/open markers remain.

## Focus and unread semantics

Focus is a derived view, never a persisted classification:

```text
in Focus = runtime state is working/waiting_approval/waiting_input
        OR a completion was observed and that completed turn is unread
```

Unread compares turn identity first and timestamps only as a compatibility fallback:

```text
if last_completed_turn_id and last_opened_turn_id are known:
  unread = last_completed_turn_id != last_opened_turn_id
else:
  unread = last_completed_at > last_opened_at (or no last_opened_at)
```

Opening a running thread records the active turn as seen. If that same turn later completes, it
does not become unread. A later completed turn does. A running thread remains in Focus even after
being opened.

`last_opened_*` changes only after `shell.openExternal(codex://threads/<id>)` resolves successfully.
Selecting a card, moving it, or opening the same thread directly inside Codex does not mark it read.
This means "unread" precisely means "not opened from EyesOnAgents since the observed completion";
Bitterless cannot observe arbitrary manual navigation inside Codex Desktop.

## XPC surface

All renderer/main/preload communication uses `electron-xpc`; each method accepts zero or one object
parameter. The minimum product surface is:

```text
EyesOnAgentsHandler (main)
  getSnapshot()
  connectAppServer()
  disconnectAppServer()
  syncThreads()
  openThread({ threadId })
  installCodexBridge()
  removeCodexBridge()
  getCodexBridgeStatus()

EyesOnAgentsRepositoryHandler (SQLite preload)
  getSnapshot()
  invalidateAppServerStatuses({ observedAt })
  upsertDiscoveredThreads({ threads })
  applyRuntimeEvent({ event })
  markOpened({ threadId, openedAt })
  createDomain({ title })
  renameDomain({ domainId, title })
  deleteDomain({ domainId })
  reorderDomains({ domainIds })
  moveThread({ threadId, domainId })
```

The main process validates UUIDs and owns process launch, provider settings, and deep links. The
SQLite preload owns all transactions and soft-delete rules. The renderer groups one snapshot in
memory; it does not issue one query per Domain.

## Safety and privacy

- Persist only IDs, titles/previews, working directories, lifecycle flags, and timestamps.
- Never store prompt text, response text, tool payloads, diffs, credentials, or approval details.
- Validate every thread ID before persistence and before constructing the deep link.
- Start Codex with `spawn`/`execFile` argument arrays and `shell: false`.
- The local hook bridge remains isolated by Bitterless `userData` identity and accepts only the
  minimal allowlisted event schema.
- Removal of the Desktop bridge changes only Bitterless-owned hook entries.

## Delivery replacement

This contract supersedes [Coding-agent Session Integration](coding-agent-sessions.md) and its
provider-neutral main-window design. Those documents remain historical evidence for the previous
implementation and are not current product requirements.
