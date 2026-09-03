# EyesOnAgents Integration

Status: Implemented; owner runtime and visual verification pending

Date: 2026-08-17

Verified: 2026-08-26 (through task 067 non-Electron checks; runtime owner verification pending)

## Decision

Replace the former provider-neutral Coding-agent Sessions page with **EyesOnAgents**, a
provider-aware Mini App that opens in its own Bitterless window. EyesOnAgents discovers local Codex
and Claude Code sessions, lists every visible task in one attention-ordered Focus column, and opens
an exact task in its provider's desktop UI. User-managed Domains are no longer exposed in the UI;
their storage is retained and unused — see
[Focus-only board](../features/eyes-on-agents-focus-board.md).

Codex retains its App Server and trusted Hook contracts. Claude is an additive adapter with
read-only Desktop metadata, bounded JSONL inventory, Agent View polling, a user-installed
Bitterless plugin/Hook, and Desktop-only Open. Its exact capability and privacy boundary is defined
by [EyesOnAgents Claude Observation](../features/eyes-on-agents-claude-observation.md).

## Goals

- Connect to a Bitterless-managed local Codex App Server and keep that connection alive while the
  application is running.
- Import Codex threads and local Claude Code sessions into a dedicated, provider-aware,
  display-oriented SQLite model.
- Persist each validated active and archived `thread/list` object as a local source snapshot, while
  keeping Bitterless-owned Domain and read markers in a separate normalized overlay.
- Put every newly discovered thread into the system `Uncategorized` Domain, which remains the
  storage fallback and is never presented in the UI.
- Show every visible thread in the single Focus column, ordered by attention: waiting for approval,
  waiting for input, visible unread dot, working, then everything else.
- Derive and persist current Git Project metadata from `cwd` without exposing a Project filter or
  changing stored Domain assignment.
- Search visible thread titles in a renderer-memory `Cmd+F` / `Ctrl+F` modal whose results reuse
  normal cards without narrowing the Focus board.
- Play the supplied completion tone and send one localized system notification when a newly
  accepted successful turn enters the same idle/unread state as the Open red dot.
- Persist the stored Domain value and the last thread opened through EyesOnAgents across restarts.
- Persist unread explicitly: every observed running state or terminal event sets unread; a
  successful Open from EyesOnAgents or explicit per-thread **Mark as read** clears attention until
  activity is observed again. The retained bulk-read mutation remains unexposed by this renderer.
- Refresh thread discovery metadata, including changed titles, whenever the EyesOnAgents window is
  activated again.
- Hide archived Codex threads and restore unarchived threads without losing their Domain or local
  read state.
- Provide a visible Refresh action that can reconnect and run full reconciliation from disconnected
  or error state as well as from an existing connection.
- Open the exact Codex Desktop task with `codex://threads/<thread-id>`.
- Open a Claude session by validated Session ID in the Claude Desktop UI without launching Claude
  CLI, with explicit read-only JSONL preview as a separate action.
- Supplement managed App Server events with an independently enabled global Codex observation
  bridge: lifecycle delivery stays metadata-only by default, while a separate opt-in may retain one
  bounded latest user question from trusted live delivery.
- Support macOS and Windows through the existing Electron/XPC architecture.

## Non-goals

- Claude.ai chat history or remote/cloud Claude sessions.
- Launching `claude --resume`, `claude attach`, or any terminal command from a Claude card.
- Reading earlier user prompts, complete transcripts, tool calls, diffs, or model output. The one
  latest-user-question exception is defined separately and remains default-off.
- Sending prompts, steering an active turn, or implementing a client-side message queue in this
  delivery. The persistent App Server client is the foundation for a later composer.
- Attaching to the private stdio child process owned by Codex Desktop.
- Treating a second App Server process as proof of Codex Desktop's in-memory state.
- Reimplementing the Codex conversation interface inside Bitterless.
- Persisting a global-search query, sending it through XPC, or searching UUID, cwd, Project,
  Domain, prompt, response, or raw App Server snapshots.

## Product boundary

EyesOnAgents receives provider-scoped evidence and keeps every authority distinct:

```text
Codex thread store
      |
      v
Bitterless-managed `codex app-server --stdio`
      |  thread/list + lifecycle notifications for work owned by this server
      v
EyesOnAgents service ------------------------------------+
      ^                                                   |
      |  lifecycle + optional bounded latest question    v
opt-in Codex Desktop hooks -> local bridge       SQLite + XPC broadcast
Claude Desktop metadata + JSONL inventory -------^       ^
Claude Agent View + plugin Hooks -> local bridge --------|
                                                          |
                                                          v
                                                EyesOnAgents window
```

The managed App Server is authoritative only for threads and turns loaded or started through that
same server instance. Codex Desktop currently owns a separate private stdio App Server and exposes
no supported external attach endpoint. A managed connection can list the shared thread store, but
it must not reinterpret `notLoaded` as idle or completed.

The same boundary applies to archive notifications. EyesOnAgents consumes `thread/archived` and
`thread/unarchived` from its managed App Server, but it does not assume that Codex Desktop's private
App Server broadcasts those events across processes. Full Sync therefore reconciles both the
non-archived and archived `thread/list` inventories from the shared store.

The Codex hook bridge is therefore the Desktop observation source. It is enabled and disabled
explicitly and independently from App Server Connect/Disconnect. It reports lifecycle transitions
for Desktop/CLI work after installation but does not provide transcripts. A prior-lifetime active
row becomes `unknown` when listener-start invalidation establishes a new lifetime. A durable event
accepted and committed by that new listener may then restore state even when the provider event
occurred while Bitterless was closed. Stale or contradictory evidence becomes `unknown`.

Claude uses an independent bridge and never inherits Codex connection or trust state. Its
user-scope Bitterless plugin is required for timely foreground working/completion observation in
both Claude CLI and local Claude Desktop Code sessions. Read-only Desktop session metadata supplies
title/activity plus an explicit `isArchived` flag, while JSONL inventory and
`claude agents --json --all` cover local discovery and runtime fallback. CLI-only rows without a
matched Desktop metadata file remain Main-private inventory until a trusted Desktop mapping exists.
The complete Claude contract is
[EyesOnAgents Claude Observation](../features/eyes-on-agents-claude-observation.md).

Claude also has one persisted provider-level support switch, default-on for upgrade compatibility.
Off means Main stops Claude inventory, watcher, retry, Agent View, Hook intake/listener, and
notifications; returned snapshots omit Claude rows without deleting their SQLite state. The
installed plugin and saved directory remain untouched. Enabling clears disabled-period outbox data,
using a persisted pending-admission sentinel before cleanup and a finite cutoff before source
admission, starts fresh inventory, and resumes only a still-valid installed plugin. A pending
sentinel is crash-recovered; ordinary enabled restarts retain their existing cutoff and valid
offline backlog. The listener remains unarmed until ordered coverage inspection and replay finish,
and late provider snapshots cannot overtake a newer Off response because Main and renderer enforce
a monotonic provider revision. Codex never reads this preference and remains fully operational in
either state.

The upstream protocols can expose conversation content: `UserPromptSubmit` supplies the exact
submitted `prompt`, `Stop` may supply `last_assistant_message`, and App Server can return history.
Under the default-off [EyesOnAgents Last User Prompt](../features/eyes-on-agents-last-user-prompt.md)
contract, the Hook helper may project only one bounded preview into a trusted live
`UserPromptSubmit` delivery; every offline delivery is stripped back to metadata before writing.
The tiered All-thread poll may also request one bounded `thread/turns/list(itemsView: "full")` page
for a selected changed thread, retain only its newest valid user-message preview, and discard every other item. It
never requests `thread/read({ includeTurns: true })` or the Codex 0.137 unsupported
`thread/turns/items/list`; responses, reasoning, tools, diffs, approvals, attachments, earlier
questions, and transcript history remain prohibited.

Codex treats the bridge as a non-managed command hook and requires the user to review and trust its
exact definition once before it runs. After installation, EyesOnAgents inspects `hooks/list` and
reports `needs_trust` until every Bitterless-owned definition is enabled and has `trusted` or
`managed` trust status. Review opens the supported `codex://settings` entry and instructs the user
to select Settings → Hooks or enter `/hooks`; Bitterless never clicks Trust, writes `trusted_hash`,
bypasses Codex hook trust, or writes managed policy.

The global helper runs as a dedicated `ELECTRON_RUN_AS_NODE` entry, never the full Bitterless main
application. When Bitterless is unavailable, it atomically stores one bounded outbox file per
delivery. The listener acknowledges only after SQLite records the delivery receipt and runtime
transition in one transaction. Startup replay plus persistent receipt dedupe covers both offline
events and a lost acknowledgement after commit. Corruption, overflow, or unavailable storage is
reported as a coverage error and invalidates live hook evidence rather than presenting it as
current. Replay pauses at that marker. After a fresh trusted inspection, one locked cutover removes
only the untrustworthy pending prefix through the marker time, acknowledges the marker last, and
replays the preserved suffix. Recovery compares the exact marker snapshot under the lock; a marker
that changed after inspection is retained and reported as a new generation instead of being cleared
by the older attempt. Recovery lock failure does not widen the delivery cutoff. The complete contract is
[EyesOnAgents Codex Observation](../features/eyes-on-agents-codex-observation.md).

While a fresh `hooks/list` inspection is pending, current-listener events remain only in a bounded
in-memory queue. EyesOnAgents writes them to SQLite in arrival order only after that inspection
proves the exact hooks trusted; it discards the whole queue on any other result, listener change,
or overflow. A prior `installed` result never authorizes events across a new inspection boundary.
EyesOnAgents establishes that pending boundary before draining writes accepted by the preceding
inspection, so events arriving during a slow write join the fresh bounded queue rather than being
dropped between admission epochs. Every queued write captures an immutable admission epoch. A
SQLite write failure rejects that epoch before any suffix can start, reports only the bounded bridge
error, invalidates hook-owned active evidence, and refreshes the renderer; a later `Refresh` must drain
the rejected tail and prove fresh trust before admission can reopen.

## App Server connection lifecycle

The main process owns one connection supervisor for the entire Bitterless process:

1. `Connect` resolves the installed Codex executable and starts `codex app-server --stdio` without a
   shell.
2. The client completes the JSON-RPC initialize handshake before reporting `connected`, opting into
   `experimentalApi` because bounded `thread/turns/list` powers the authorized prompt recovery and
   content-free terminal reconciliation paths.
3. If Codex observation is already enabled, it may call `hooks/list` to refresh its separate trust
   status; it never installs or repairs hooks as a side effect.
4. It pages through non-archived and archived `thread/list` inventories, stores each UUID-validated
   raw object locally, independently normalizes optional display fields, reconciles known archived
   rows, and leaves the child process running. A malformed optional preview, name, cwd, or status
   detail never excludes an otherwise valid thread.
5. Notifications such as `thread/status/changed`, `turn/started`, `turn/completed`,
   `thread/archived`, and `thread/unarchived` update the repository and broadcast a compact change
   event to EyesOnAgents renderers.
6. Trusted Desktop hook events update the same repository while preserving their separate evidence
   source.
7. Unexpected process exit changes the connection to `error`; it never fabricates thread state.
8. Explicit `Disconnect` terminates only the Bitterless-owned App Server. Global hook definitions,
   the listener, trust evidence, and observation intent remain unchanged.

A successful explicit connection enables auto-connect for later Bitterless launches. Explicit
disconnect disables auto-connect. Connection preference belongs in the existing setting store;
thread and Domain state belongs in the dedicated tables below.

The renderer can request only `connect`, `disconnect`, full refresh/sync, the parameter-free tiered
thread refresh, and status inspection. It cannot provide an executable, command arguments, URL,
thread IDs, page selection, or an arbitrary JSON-RPC method.

### Explicit refresh fallback

The header exposes a labelled `Refresh` action rather than an icon-only connected-state Sync. It
runs the same full active-plus-archived reconciliation as connection and activation refresh:

- while connected, it refreshes both inventories immediately;
- while disconnected or in error, it starts the allowlisted managed App Server, refreshes, and
  leaves the connection alive;
- while another board action, connection, or sync is in flight, it is disabled so no conflicting
  mutation or duplicate inventory request starts;
- on failure, the last persisted source snapshots, Domains, and read markers remain available.

After inventory reconciliation, manual Refresh also runs the same hot-first/current-cold-page detail
pass used by the ten-second poll. This lets a recently active Hook-owned task consume exact
metadata-only terminal-turn proof immediately, so a manually stopped task can lose its stale
`working` presentation without waiting for the next interval. If a task is outside the selected
pages, the existing cold-page rotation still provides eventual reconciliation.

When observation is installed, Refresh first attempts a fresh Hook inspection and any required
coverage cutover so a preserved Desktop lifecycle suffix can reach SQLite before the returned
snapshot is derived. Observation failure is reported independently and never prevents the managed
App Server from reconciling active and archived inventory. Conversely, an inventory result of
`notLoaded` cannot substitute for Desktop lifecycle evidence or fabricate Focus.

Refresh never launches Electron helpers, scans transcripts, or accepts user-supplied commands. It
is the manual recovery path when activation delivery, lifecycle notifications, or title propagation
have not yet caught up.

### Periodic refresh polling

While the EyesOnAgents renderer is mounted, one store-owned interval requests a silent tiered refresh
every `10_000` milliseconds. Main and SQLite, never renderer state, choose fixed 40-row pages across
every persisted non-archived All thread. Each admitted tick snapshots page 1 plus the current cold
page, processes the hot page first, then one cold page in the cycle
`2 -> 3 -> ... -> last -> 2`. One tick therefore contains at most two batches and 80 rows.

Candidate order is deterministic recency:
`COALESCE(last_activity_at, updated_at) DESC`, then `updated_at DESC`, then `thread_id ASC`.
The renderer search query, Domain membership, Focus membership, and attention ordering do not
alter coverage. A reduced page count resets the cold cursor to page 2. Cancellation or repository
failure does not advance it; individual malformed or failed rows are skipped so one row cannot
starve the rest of the cold sweep.

The independent App Server's `thread/read.status` describes that managed process, not Codex
Desktop. The tiered poll therefore never projects a runtime patch. Hook events and lifecycle
notifications from the connection that owns a turn are the runtime authorities. Once a SQLite page
mutation has started, Main waits for that mutation to settle even if the App Server context is
cancelled; teardown cannot lose track of a late write, and the cancelled page remains incomplete so
its cold cursor does not advance.

The poll follows persisted connection intent:

| current state | polling behavior |
|---|---|
| `connected` | run `refreshThreadPages()` without renderer loading state |
| `disconnected` or `error` with auto-connect enabled | reconnect through the managed allowlisted App Server, then refresh the selected hot/cold pages |
| `connecting`, `syncing`, another board action, or snapshot load in flight | skip this tick without queuing another request |
| explicitly disconnected with auto-connect disabled | skip this tick; only an explicit foreground action may reconnect |

Starting the poll is idempotent, so repeated initialization cannot create another interval. The
renderer clears the interval and its stored handle on unmount. One dedicated background promise
drops later ticks and never writes the foreground `busyAction`; header and drawer Refresh buttons
therefore remain still. The semantic XPC accepts no IDs or page input. Each batch runs at most four
row pipelines concurrently and calls per-thread
`thread/read({ includeTurns: false })`, never active/archived `thread/list`, `hooks/list`, Project
resolution, archive reconciliation, or raw snapshot persistence.

That XPC returns only `{ changed: boolean }`, never a snapshot. An unchanged poll therefore sends no
snapshot across XPC and performs no renderer reactive replacement. Each changed batch emits one
existing `eyes-on-agents/changed` broadcast, whose established subscription reloads the current
snapshot; a tick can therefore emit at most one hot and one cold change broadcast. A fully unchanged
tick emits no repository data-change broadcast. App Server connection-state notifications remain a
separate broadcast source. Concurrent poll callers share the same
result-bearing Main promise. Foreground Connect/Refresh increments a Main admission counter before
waiting for an already admitted poll; while that counter is nonzero, a new poll returns unchanged.
The automatic full sync after `thread/unarchived` uses the same admission-and-join ordering. This
prevents foreground/background App Server overlap independently of renderer state.

The repository compares optional title, provider activity, and prompt patches independently
and updates `updated_at` only with a real semantic change. A reliable provider activity watermark
may advance `last_activity_at` monotonically so a newly active row joins the next hot page. An
unchanged poll performs no SQLite UPDATE and no renderer broadcast. If **Store latest user
question** is enabled, descending one-turn full-items pages are read only when provider activity has
advanced beyond the persisted content-check watermark. Recovery stops at the newest textual user
message and scans no more than ten turns. The other response items never leave main-process memory.
Codex 0.137 does not implement
`thread/turns/items/list`, so EyesOnAgents does not call it. Every returned turn must either omit
`itemsView` or explicitly report `full`; an explicit `summary`, `notLoaded`, or other view rejects the
content page and does not advance the prompt check watermark.

The tiered path can update title, activity, and opted-in latest-question state only for already
persisted rows. It cannot update runtime/Focus evidence, discover a new thread, or reconcile archive
and Project metadata; window activation and labelled manual Refresh remain the full-inventory
fallback.
Explicit Disconnect still prevents the background operation from reconnecting.

### Normalized admission and Hook-first title repair

Thread admission and display projection are separate. A valid UUID admits the row. Title resolution
accepts a valid bounded `name` first and never inspects `preview` in that case; only a missing or
invalid name uses a preview fallback whose whitespace is folded and whose Unicode text is safely
truncated to 300 display characters. Invalid optional cwd/status values degrade only those fields.
The full provider object remains unchanged in `eyes_on_agents_thread_snapshot` and never enters the
normalized row.

Full Refresh writes raw snapshots before normalized rows, so a lifecycle event that first creates a
row can restore a missing title from an already stored snapshot in the same SQLite transaction. If
that snapshot has no usable title and the existing managed App Server context is already connected,
Main schedules one thread-ID-deduplicated `thread/read({ includeTurns: false })` after the lifecycle
transaction commits. This repair projects title only: it does not auto-connect, fetch turns, delay a
Hook ACK, or apply runtime/activity evidence. A later lifecycle event reuses the in-flight repair.

Skipped/rejected repair diagnostics contain only a fixed reason enum, validated UUID, and integer
time. Provider errors, responses, previews, and other content are never logged. Full Refresh and the
tiered All poll remain bounded retry paths, while a successful no-op emits no SQLite write or board
broadcast.

### Window activation refresh

The EyesOnAgents renderer listens for its own top-level window to regain focus. Each focus
transition requests one foreground refresh so metadata that has no lifecycle notification, such as
a renamed thread title or a Desktop-owned archive transition, is updated from `thread/list` without
waiting for a manual Sync.

The Desktop-owned App Server's `thread/name/updated` notification does not cross into the separate
Bitterless-managed App Server process, and the Hook envelope has no title field. `thread/list` is
therefore the cross-process reconciliation source for renames: connected activation refreshes it,
and the labelled Refresh action is the explicit fallback after a deliberate disconnect or missed
activation.

The inventory refresh respects connection intent. Independently, activation rechecks installed
Codex observation trust by reusing the connected App Server or a short inspection connection that
does not change auto-connect intent:

| current state | activation behavior |
|---|---|
| `connected` | run `syncThreads()` and apply the returned snapshot |
| `disconnected` or `error` with auto-connect enabled | retry `syncThreads()` |
| `connecting` or `syncing` | quietly reload the current snapshot; the in-flight operation broadcasts its completion |
| explicitly disconnected with auto-connect disabled | reload local SQLite state; if observation is installed, use a short `hooks/list` inspector and then disconnect |
| initial snapshot not loaded | coalesce with the existing snapshot load |

The store's existing single busy action and coalesced snapshot load prevent overlapping activation
requests. The listener is removed when the renderer unmounts. Activation refresh and the single
ten-second tiered poll honor the same connection intent. Main's foreground admission counter, rather
than a shared renderer loading state, prevents them from creating parallel App Server work.
The separate renderer-global presentation clock remains presentation only; it never refreshes or
persists thread data. A failed activation uses the existing action error surface; a failed periodic
poll stays silent. Both retain the last valid snapshot.

### Archive visibility and reconciliation

Codex App Server `thread/list` returns only non-archived threads by default and only archived
threads when `archived: true`. Its `thread/archived` and `thread/unarchived` notifications carry
only `{ threadId }`. EyesOnAgents uses those protocol facts as follows:

- `thread/archived` marks a known row archived, clears transient active evidence, and broadcasts so
  the row disappears from the Focus column immediately.
- `thread/unarchived` clears the archive flag for a known row, clears stale active evidence,
  broadcasts, and runs a full Sync so a previously unknown row can be imported and current metadata
  replaces the retained snapshot.
- Full Sync first upserts every non-archived thread with `is_archived = 0`, then marks only thread IDs
  explicitly returned by the archived inventory with `is_archived = 1`. It never infers archive from
  absence because provider/source filters and malformed entries can also omit a row.
- If the two paged inventories overlap during an archive race, the later archived inventory wins;
  the lifecycle notification or next activation Sync repairs a concurrent unarchive.
- A malformed archived entry is ignored individually, matching existing discovery parsing, and
  cannot hide an unrelated row.
- Archived rows remain in SQLite but are excluded from renderer snapshots. Domain assignment,
  Project metadata, completion/open markers, and unread history are preserved across archive and
  unarchive.
- A Codex card may request provider-authoritative archive through App Server `thread/archive`.
  Bitterless persists `archived` and broadcasts only after that request succeeds, so the card
  disappears immediately and other Monitor renderers converge. Provider failure leaves the row
  visible and surfaces the existing action error. The later archive notification and active plus
  archived inventory Sync remain idempotent repair paths. EyesOnAgents does not read archived
  transcripts.

Protocol basis: the official
[Codex App Server reference](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
and the TypeScript schema generated from the bundled Codex CLI version used by Bitterless.

These App Server archive rules are Codex-only. A matched Claude Desktop metadata file supplies its
own explicit `isArchived` boolean and may hide or restore that Claude row. Claude Desktop deletion
is independently represented by an exact `deleted_<uuid>` tombstone in the same bounded metadata
scope. Bitterless persists that positive evidence, soft-deletes the matching Claude identity, and
suppresses residual JSONL, Agent View, and late Hook resurrection until Claude Desktop removes the
tombstone and publishes newer unique live metadata. A CLI-only Claude row remains internal and has
unknown archive state; file absence, JSONL deletion, process exit, and Agent View omission never
imply archive or delete.

Monitor therefore exposes Archive only for Codex. It does not write Claude Desktop metadata, create
a deletion tombstone, or locally mark a Claude row archived: all three would misrepresent provider
state and a later Desktop inventory pass could reverse the result.

## Domain model

EyesOnAgents uses dedicated tables rather than Todo's `domain` and `todo` tables. The two products
must not share ordering, archive, or deletion semantics.

Since task 054 no UI exposes Domains. The tables, columns, XPC methods, and transactional semantics
below are retained unchanged so stored assignments survive and the surface can be restored or fully
removed later; the renderer simply never calls them and never renders a Domain.

### `eyes_on_agents_domain`

| column | meaning |
|---|---|
| `id` | integer primary key |
| `domain_key` | stable unique key; `uncategorized` is reserved |
| `title` | user-visible title |
| `sort_index` | wrapped board order for stored Domains |
| `is_system` | system Domains cannot be renamed or deleted |
| `is_deleted` | soft-delete flag |
| `delete_flag` | active value `0`; deletion timestamp string for unique-key reuse |
| `deleted_at` | soft-delete time |
| `created_at`, `updated_at` | lifecycle timestamps |

`Uncategorized` is inserted idempotently during SQLite bootstrap with `is_system = true` and kept
as the internal fallback assignment. The renderer's fixed projection is Focus; neither the retired
All view nor Focus is stored as a separate table row.

### `eyes_on_agents_thread`

| column | meaning |
|---|---|
| `session_key` | internal primary key in the form `<provider>:<provider-session-id>` |
| `provider` | `codex` or `claude` |
| `thread_id` | validated provider-owned UUID; unique together with `provider` |
| `desktop_session_id` | nullable validated Claude Desktop `local_<uuid>` identity used only for UI routing |
| `iterm2_session_id` | nullable validated `ITERM_SESSION_ID` (`w<n>t<n>p<n>:<uuid>`) captured on `SessionStart` inside iTerm2, used only for UI routing to **Open in iTerm2** |
| `claude_config_dir` | nullable `CLAUDE_CONFIG_DIR` absolute path captured on `SessionStart` (schema V4); not a foreign key — resolved against currently configured Claude environments at snapshot-read time |
| `domain_id` | non-null reference to an active EyesOnAgents Domain |
| `title` | Codex name/preview fallback, display only |
| `cwd` | working directory when Codex exposes it |
| `project_key` | normalized nearest Git worktree root used for grouping/filtering |
| `project_root` | canonical native Git worktree root for display |
| `project_name` | compact worktree-root basename |
| `archive_state` | `active`, `archived`, or `unknown`; only explicit `archived` is hidden |
| `runtime_state` | normalized status enum |
| `active_flags_json` | App Server active flags, never transcript content |
| `active_turn_id` | currently observed turn when known |
| `last_completed_turn_id` | most recently observed terminal turn when known |
| `last_completed_at` | most recent observed terminal time |
| `last_opened_turn_id` | terminal/active turn seen when opened through EyesOnAgents |
| `last_opened_at` | successful Codex deep-link open time |
| `is_unread` | persistent Bitterless attention marker; active/terminal observations set it, successful Open or explicit per-thread Mark as read clears it; the retained terminal-only bulk clear is unexposed |
| `status_source` | provider-scoped App Server, Hook, Agent View, or discovery authority |
| `status_observed_at` | freshness boundary for runtime evidence |
| `last_activity_at` | sort/display timestamp from reliable metadata or events |
| `created_at`, `updated_at` | local lifecycle timestamps |

### `eyes_on_agents_thread_snapshot`

| column | meaning |
|---|---|
| `session_key` | provider-qualified primary key and link to the normalized overlay |
| `provider` | snapshot owner; Claude snapshots remain metadata-only |
| `thread_id` | validated provider-owned UUID |
| `payload_json` | complete JSON object returned for that thread by the latest `thread/list` inventory |
| `is_archived` | whether the object came from the archived inventory |
| `synced_at` | time this exact source object was observed |
| `created_at`, `updated_at` | local snapshot lifecycle timestamps |

Source snapshot upsert and normalized overlay upsert apply the same UUID validation. A refresh
replaces `payload_json` for an observed thread but never overwrites `domain_id`, Project metadata
chosen by Bitterless, open markers, or `is_unread`. Absence from an inventory does not delete a raw
snapshot because filters and concurrent archive transitions can omit entries.

The provider-identity migration converts every current EyesOnAgents row and receipt to `codex`
without changing Domain, runtime, archive, unread, prompt, or Open state. It then imports valid
legacy Claude rows idempotently when no provider-qualified row exists and never drops the legacy
table. Imported and newly discovered rows are assigned to `Uncategorized`; subsequent syncs
preserve an existing Domain assignment. Historical import does not synthesize a completion marker,
so old sessions do not flood Focus as unread.

Deleting a custom Domain soft-deletes it and moves all of its threads to `Uncategorized` in one
transaction. The system Domain cannot be renamed or deleted, and the affected threads remain
visible in the complete Focus projection throughout the change.

## Project source metadata

Codex App Server has no Project catalog. EyesOnAgents resolves the nearest current Git worktree root
from each thread's `cwd` in the main process and persists the resulting Project metadata. A valid
non-Git directory explicitly clears Project metadata; an inaccessible or otherwise unavailable path
preserves the last known value. A `.git` directory and a bounded `gitdir:` file both identify a
worktree, so nested repositories, submodules, and linked worktrees use their nearest root.

Project is a source dimension, not classification. It never creates a Domain and never changes
`domain_id`. Main still resolves and stores it, but the renderer Project filter, options, counts,
and selection state are retired. See
[EyesOnAgents Project Filter](../features/eyes-on-agents-project-filter.md) for that retained-storage,
retired-UI contract.

EyesOnAgents has a renderer-session search modal, reached by the Focus Search button or `Cmd+F` /
`Ctrl+F`, which suppresses Chromium's native page Find. Repeating the shortcut while the modal is
open closes it. Query and title text are normalized with Unicode
NFKC and locale-aware lowercase, then split on whitespace, hyphen, underscore, period, forward
slash, backslash, colon, and vertical bar. A title matches only when every query token is a
substring of at least one title token; token order does not matter. An empty, cleared, or
separator-only query renders no result cards and a quiet start-typing state.

The query never reads raw source snapshots or conversation content, never matches thread ID, cwd,
Project, Domain, prompt, response, or `payload_json`, and never changes persisted thread or Domain
state. Query text, provider-qualified selection, and result visibility remain in renderer memory,
and no search-specific XPC, SQLite, App Server request, or polling loop exists. The Focus board
remains complete behind the modal. Results directly reuse `ThreadCard`; Up/Down wrap selection and
Enter commits the newest draft before using the established `openThread(sessionKey)` path. Opening
successfully closes and clears Search; a failed or guarded Open preserves the query and selection
for retry.

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
  | "app_server_turn"
  | "codex_hook"
  | "discovery";
```

App Server active flags map approval/input waits ahead of generic working. `notLoaded` maps to
`unknown`, not idle. A terminal turn notification records completion independently from the
thread's resulting idle state.

Hook evidence may override discovery evidence when it is newer. App Server lifecycle events from
the managed connection are authoritative for that connection. `app_server_turn` is not a lifecycle
source: it marks active state reconstructed from persisted newest-turn metadata and is ranked below
Hook evidence, which supersedes it through the normal watermark rule. See *Missed working recovery*
below for its full precedence, preservation, and rendering rules. Hook-active evidence remains valid
until terminal evidence only while it was committed through the currently listening bridge runtime
and all owned hooks are trusted. Listener startup first invalidates previous active Hook rows; a
subsequent current-listener outbox replay is therefore valid even when the provider occurrence time
predates `listeningSince`. That explicit authority can replace only `discovery + unknown`; it cannot
overwrite newer concrete App Server or Hook evidence. A later Bitterless restart invalidates it again unless new delivery
restores it. Durable completion/open markers remain. There is no 60-second active expiry because
Codex emits no running heartbeat.

## Focus and unread semantics

Focus is a derived view, never a persisted classification. Unread and successful Open timestamps
are persisted Bitterless markers:

```text
in Focus = runtime state is working/waiting_approval/waiting_input
        OR is_unread = true
```

Focus membership is a pure function of the currently displayed runtime state and the unread marker.
`last_opened_at` and `last_opened_turn_id` remain durable deep-link evidence, but neither field is
allowed to hide a task that is still running. Runtime attention and read acknowledgement are
separate facts, so a running task that the user opened stays in Focus until the observation actually
resolves. `isEyesOnAgentsFocused` therefore takes only runtime state and unread; Main derives it
from the effective runtime state, and the renderer derives the Focus column in memory from the same
shared predicate.

Every accepted `turn_started`, active `thread_status`, active `thread/list` observation, and
`turn_completed` sets `is_unread = true`. This includes the completion of a turn that was opened
while running: completion is a new attention transition and becomes unread again. Metadata polling
cannot restore active runtime attention. Idle, unknown, archive, and invalidation transitions
otherwise preserve the current marker.

The legacy completion/open comparison is used once by migration to backfill the new column, so an
upgrade preserves previously unread completed threads without flooding Focus with historical rows.

Both acknowledgement paths share one positive terminal allowlist — `idle`, `failed`, and `ended`:

- A successful Open always records `last_opened_turn_id` and `last_opened_at`. It clears
  `is_unread` only when the row is in a confirmed terminal state. Active and `unknown` rows keep
  their latent marker, so neither a still-running turn nor a temporary authority gap can be
  acknowledged away.
- Marking a Codex row unread while it sits at `status_source = 'discovery'`,
  `runtime_state = 'unknown'`, no active turn, and a non-null `status_observed_at` makes it a
  recovery candidate for the next background refresh: the poll may then settle its turn from
  metadata-only proof and, if that proof is a fresh completion, claim one completion alert. That is
  observation correcting the row rather than the toggle rewriting runtime state, but it is a real
  consequence of re-flagging an `unknown` row.
- The per-thread manual toggle writes only `is_unread` for one non-archived row, in either
  direction and in any runtime state. It is an acknowledgement, not a deep-link receipt: it never
  writes `last_opened_*`, runtime evidence, `updated_at`, or archive state, so it can neither forge an
  Open nor disturb the `COALESCE(last_activity_at, updated_at)` refresh ordering. Observation stays
  authoritative — a later accepted Hook or App Server event may overwrite a manual value, which is
  what keeps "unread" meaning observed-and-unacknowledged. On an active or `unknown` row the flag is
  latent until the row settles.
- The retained, renderer-unexposed bulk-read mutation clears `is_unread` for every non-archived unread terminal row belonging to the
  Main-provided visible-provider allowlist in one repository mutation. It is not filtered by
  renderer DOM, current scroll position, Project, or search query, it does not deep-link to Codex,
  and it never changes runtime evidence or `last_opened_*`. When Claude is paused the allowlist is
  Codex-only, so hidden Claude attention is preserved. EyesOnAgents exposes no bulk-clear control.

Acknowledged terminal rows lose the unread rank and dot but remain in the complete Focus board. A
newer lifecycle observation committed after either mutation may set a cleared thread unread again,
preserving newer activity. Metadata polling cannot do so.

`last_opened_*` changes only after `shell.openExternal(codex://threads/<id>)` resolves successfully.
Selecting a card, moving it, or opening the same thread directly inside Codex does not mark it read.
This means "unread" precisely means "attention observed by EyesOnAgents and not yet acknowledged by
a successful Open or explicit per-thread acknowledgement". Bitterless cannot observe arbitrary manual
navigation inside Codex Desktop.

A `Stop` Hook proves only that the turn stopped; it is not a read receipt and contains no supported
signal that Codex still has this thread selected, frontmost, or viewed. App Server likewise exposes
no documented selected-thread or read event. Consequently, if the user remains in Codex and reads
the answer as it completes, EyesOnAgents conservatively keeps the completion unread until Open
succeeds from EyesOnAgents or the user explicitly marks that thread read. Completion must never
auto-clear unread.

Codex Hook delivery may miss a manual interruption. EyesOnAgents does not add a `paused` state, scan
private rollout/transcript files, or expire working by elapsed time. Instead, the existing hot/cold
poll may inspect only the newest turn for a selected row through
`thread/turns/list(itemsView: notLoaded, sortDirection: desc, limit: 1)`. This request does not load
turn items or conversation content into Bitterless; Main projects only ID, status, start time, and
completion time from the response. Exactly one of two candidate kinds may consume that single
request per selected task: an already-active row with an exact turn identity, which may only be
reconciled terminally, or an unread `discovery + unknown` recovery candidate (see below), which may
either recover `inProgress` or settle from valid terminal evidence. `inProgress` changes nothing
for the first kind. A `completed`, `interrupted`, or
`failed` result may reconcile the row only when its turn ID exactly matches the current active turn
and it carries a non-null persisted completion time. The second-precision completion value is not
ordered against the millisecond Hook observation and does not create a new status watermark;
identity plus SQLite compare-and-set provides the freshness fence. The completed turn ID also blocks
a delayed active event for that same turn, while a different turn ID may start normally. Missing
identity or completion time is a no-op. SQLite repeats those guards against the current row so a
delayed request cannot terminate a newer turn. Reconciliation clears active state but sets unread:
the task remains unread until Open or explicit per-thread acknowledgement, and a later prompt restores
working through `UserPromptSubmit`.

### Missed working recovery

A Hook listener lifetime boundary invalidates old Hook-owned active evidence to
`discovery + unknown` with no active turn while preserving unread. Codex does not replay
`UserPromptSubmit` for a turn that was already running before the new listener, so nothing can push
that row back to `working` on its own. Because terminal reconciliation only ever asked for rows that
were already active, such a row stayed `unknown + unread` indefinitely: visibly in Focus, with no
working spinner, and unrepaired by both the ten-second poll and labelled `Refresh`.

The same content-free newest-turn request therefore also serves a **missed-working recovery
candidate**: a non-archived, unread, `discovery + unknown` row with no active turn and a concrete
`status_observed_at` watermark. A latest turn whose status is `inProgress`, whose ID is real, and
whose persisted start time is no later than the poll may restore `working`. A latest
`completed`, `interrupted`, or `failed` turn with a real ID and persisted completion time no later
than the poll instead settles the candidate to `idle`, `ended`, or `failed`. Empty, malformed,
ID-less, time-less, future-dated, or unsupported evidence is a no-op. No elapsed-time guess, private
transcript scan, response content, or `paused` state is introduced, and `thread/list.status` /
`thread/read.status` remain outside the Desktop runtime authority boundary.

Recovered evidence is recorded under a distinct `app_server_turn` status source, never the
process-local `app_server` source:

- SQLite compare-and-sets against the exact selected candidate — unread bit, `discovery` source,
  `unknown` runtime, absent active turn, unchanged watermark — and rejects a turn already recorded
  as completed. A newer Hook event, archive, replacement turn, or acknowledgement makes a delayed
  patch a no-op.
- The write sets `working`, the real active turn ID, the persisted start time as both the status
  watermark and an activity floor, and keeps the row unread.
- Full `notLoaded` inventory discovery and App Server reconnect invalidation both preserve
  `app_server_turn` identity, so labelled `Refresh`'s sync-before-detail order stays safe.
- A recovered row is an ordinary exact-ID terminal reconciliation candidate afterwards. The terminal
  compare-and-set includes the expected status source, so a Hook expectation cannot end a recovered
  row and vice versa.
- Real Hook evidence supersedes recovered evidence through the normal watermark rule.
- Snapshot projection renders a recovered active state only while the managed App Server reader is
  connected; otherwise it degrades to `unknown` exactly like process-local `app_server` evidence.
- Terminal settlement compare-and-sets the same unread `discovery + unknown` shape and exact status
  watermark, requires that no active turn has appeared, records the terminal identity/time under
  `app_server`, clears active evidence, and keeps unread. A completed settlement uses the durable
  completion-alert claim, so repeated polling cannot notify twice. An equal existing
  `last_completed_turn_id` does not block runtime settlement because listener invalidation can
  preserve the completion marker while losing its terminal runtime projection.

A periodic or manual refresh may settle runtime state but never marks the task read. A successful
`Open` runs the one-thread sync before its final acknowledgement, so a candidate settled terminally
during that Open is cleared in the same click. If evidence stays active, unknown, unavailable, or
loses the compare-and-set race, the existing positive terminal allowlist preserves unread.

### Open status sync and authority reclaim

A successful `Open` runs one status sync for that thread alone after the deep link succeeds and
before the final `markOpened`, using the same newest-turn request and candidate classification as
the tiered poll. It is an on-demand trigger of existing evidence, never a new authority, and it
makes an explicit user action at least as strong as waiting for the next tick. The sync is best
effort: a disconnected App Server, a rejected request, a malformed response, a teardown, or a lost
race does not fail the successful deep link; final `markOpened` still records Open evidence and
applies the current positive terminal allowlist. A thread that is neither an active candidate nor
a recovery candidate issues no request. The sync runs inside the existing App Server operation
fencing, so it cannot overlap a teardown, a foreground sync, or the background refresh, and it
never requests the latest user question.

The sync also covers the second way a row renders `unknown`. A row persisted as `codex_hook` with
an active runtime state and a real active turn degrades to `unknown` whenever the Hook bridge is
not listening — correct, because stale Hook evidence must not survive a listener gap. But the
managed App Server may still be connected and can still answer, content-free, whether that exact
turn is in progress. `inProgress` therefore stops being an unconditional no-op:

- When the shared projection already degrades a `codex_hook`-sourced active row to `unknown` — that
  is, when its authority is absent — and the newest turn is `inProgress` with an ID matching the
  exact persisted active turn and a persisted start time no later than the poll, Bitterless
  **reclaims** the row under the `app_server_turn` source.
- `inProgress` remains a no-op for a row whose authority is present. Nothing is inferred while Hook
  evidence is live.
- A reclaim writes only the source, the status watermark (the persisted start time), and an activity
  floor. It preserves `runtime_state` and `active_flags_json`, so a task last observed
  `waiting_approval` is not silently downgraded to `working` and dropped from the top of the Focus
  order. App Server proves the turn is still running; it does not claim to know the sub-state, and
  the previously observed wait remains the best available detail until newer Hook evidence replaces
  it.
- SQLite compare-and-sets against the exact prior row — non-archived, `codex_hook`-sourced, an
  active runtime state, the exact active turn ID and status watermark, and a turn not already
  recorded as completed. Any concurrent change makes the patch a no-op.
- A reclaimed row then behaves exactly like a recovered one: it survives full inventory discovery
  and App Server reconnect invalidation, it is an ordinary exact-ID terminal reconciliation
  candidate under its own expected source, it renders active only while the managed reader is
  connected, and real Hook evidence supersedes it through the normal watermark rule.

Terminal reconciliation, active recovery, terminal settlement, and reclaim are mutually exclusive
for one thread in one pass; the shared XPC/repository boundary rejects a patch carrying more than
one. Because the projection is shared, the ten-second poll gains the same settlement and reclaim:
`Open` is the immediate trigger and the poll is the passive one, with no new interval and still at
most one newest-turn request per selected task.

## Completion sound and system notification

A newly accepted successful completion produces an alert only when persistence changes the thread
to `idle`, records a concrete `last_completed_turn_id`, and sets `is_unread = true` — the same state
that renders the Open red dot. `failed` and `interrupted` remain terminal Focus states but do not
currently render that dot, so they do not emit this success alert.

The `(thread_id, turn_id)` completion-notification receipt is the durable dedupe fence. Immediate
Hook delivery, managed App Server notification, and the content-free terminal poll may race, but
only the first accepted SQLite transaction inserts the receipt and returns an alert intent. The
upgrade migration seeds receipts for existing completed turns. Loading a snapshot, importing
existing tasks, or reconnecting without a new completion never scans or replays historical alerts.

Main emits the side effect after persistence and before the normal renderer update. The native
notification title/body use the current application i18n messages and include only a bounded thread
title or localized untitled fallback. Prompt, response, reasoning, tool, attachment, and path
content remain excluded. The packaged notification is silent while a separate platform player
plays `eyes-on-agents-thread-completed.wav`, preventing the OS default sound from doubling the
supplied tone. A sound or notification failure is non-fatal and never changes Hook ACK or SQLite
state.

## XPC surface

All renderer/main/preload communication uses `electron-xpc`; each method accepts zero or one object
parameter. The minimum product surface is:

```text
EyesOnAgentsHandler (main)
  getSnapshot()
  connectAppServer()
  disconnectAppServer()
  syncThreads()
  refreshThreadPages() -> { changed }
  openThread({ sessionKey })
  openThreadInIterm2({ sessionKey })
  previewClaudeTranscript({ sessionKey })
  markAllRead()
  installCodexBridge()
  reviewCodexBridge()
  refreshCodexBridgeStatus()
  removeCodexBridge()
  getCodexBridgeStatus()
  installClaudeBridge()
  refreshClaudeBridgeStatus()
  removeClaudeBridge()
  getClaudeBridgeStatus()
  setClaudeProviderEnabled({ enabled })
  setLastUserPromptCaptureEnabled({ enabled })

EyesOnAgentsRepositoryHandler (SQLite preload)
  getSnapshot()
  getThreadRefreshPages({ coldPage, previousPageCount }) -> { hot, cold, pageCount, coldPage }
  refreshThreadPage({ threads }) -> { changed }
  clearLastUserPrompts() -> { changed }
  invalidateAppServerStatuses({ observedAt })
  upsertDiscoveredThreads({ threads })
  upsertThreadSnapshots({ snapshots })
  applyRuntimeEvent({ event })
  markOpened({ sessionKey, openedAt })
  markAllRead() -> { changed }
  createDomain({ title })
  renameDomain({ domainId, title })
  deleteDomain({ domainId })
  reorderDomains({ domainIds })
  moveThread({ sessionKey, domainId })
```

The main process validates provider-qualified identities and owns provider settings, fixed desktop
deep links, and canonical transcript-preview targets. The
SQLite preload owns all transactions and soft-delete rules. The renderer groups one snapshot in
memory; it does not issue one query per Domain.

## Safety and privacy

- Persist the complete object returned by `thread/list` only in the local source snapshot table.
  Current Codex schemas say list results have empty `turns`, but `preview` is usually derived from
  the first user message and is therefore potentially sensitive.
- Never send raw snapshot payloads to the renderer or include them in logs, errors, telemetry, or
  exports. Renderer snapshots continue to contain only normalized observation metadata.
- Name-first normalized title projection may read an already stored raw snapshot inside SQLite, but
  persists only the bounded title. A title-repair diagnostic is content-free and enum-bounded.
- Use `thread/read({ includeTurns: false })` only for the narrow selected-row title/status/activity
  projection; never persist its raw object. When the separate default-off consent is enabled, one bounded
  `thread/turns/list` page may project only the newest user question under the contract above. Never
  store turns, response text, tool payloads, diffs, credentials, or approval details.
- Although `UserPromptSubmit` Hook input contains `prompt`, forward it only as the separately
  consented bounded live preview and strip it before every offline write. `Stop.last_assistant_message`
  and every other content field remain outside the allowlist and are never forwarded or persisted.
- Validate every provider/session pair before persistence and before constructing a fixed desktop
  deep link. Renderer input never supplies a URL, executable, command, or transcript path.
- Start Codex with `spawn`/`execFile` argument arrays and `shell: false`.
- The local hook bridge remains isolated by Bitterless `userData` identity and accepts only the
  minimal allowlisted event schema.
- Removal of the Desktop bridge changes only Bitterless-owned hook entries.

## Delivery replacement

This contract supersedes [Coding-agent Session Integration](coding-agent-sessions.md) and its
provider-neutral main-window design. Its retired runtime is not restored; the new Claude adapter is
provider-qualified and uses current EyesOnAgents reliability/privacy contracts. Those documents
remain historical evidence and are not current product requirements.
