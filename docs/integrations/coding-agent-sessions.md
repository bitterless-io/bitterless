# Coding-agent Session Integration

Status: proposed technical contract

Verified: 2026-07-15

## Decision

Build one provider-neutral **Coding-agent Sessions** registry in Bitterless, backed by provider
adapters for Codex and Claude. Keep opening a session separate from observing its runtime state:

- Open known Codex Desktop tasks with the documented canonical form
  `codex://threads/<thread-id>`.
- Observe Codex tasks owned by a Bitterless-managed App Server through its JSON-RPC lifecycle.
  Observe other Codex Desktop/CLI tasks through opt-in Codex hooks, with freshness limits.
- Discover Claude Code CLI/Agent View sessions with `claude agents --json`; use a background job's
  ID and `claude attach <job-id>` to attach in a terminal. Add `--all` only when the installed CLI
  advertises that option.
- Resume a known, inactive Claude Code CLI conversation with
  `claude --resume <session-id>` from its original working directory.
- Use Claude hooks only to fill the status gap for foreground interactive sessions.
- Represent any state that is not backed by current provider evidence as `unknown`.

There is no single public interface that exposes exact live state for every historical Codex and
Claude conversation across every desktop, CLI, and cloud process. The design therefore records the
state's source, confidence, and observation time instead of presenting a guessed universal status.

`claude agents --json` is a **Claude Code CLI command**, not a Claude Desktop API. It does not list
Claude Desktop chats, Desktop Code sessions, or arbitrary cloud sessions. In this document,
"Claude background job" always means a session hosted by the Claude Code Agent View supervisor.

## Implemented delivery scope

The external-session feature includes phases 1-3 below: provider-neutral persistence, safe opening,
read-only Codex/Claude discovery, Claude background attach/resume, and opt-in lifecycle bridges.
The UI contract is [Coding-agent sessions layout](coding-agent-sessions-layout.md).

The managed Codex App Server supervisor in phase 4 is an optional future execution surface, not part
of this delivery. It does not improve the accuracy of status for tasks already owned by Codex
Desktop, which is the target of this integration. The read-only Codex discovery adapter may start a
short-lived App Server to call `thread/list`; every `notLoaded` result remains `unknown` unless a
fresh hook event exists.

## Goals

- List registered/discovered Codex and Claude sessions in one Bitterless surface.
- Open or attach to the exact session when the provider exposes a safe supported route.
- Distinguish active work, approval/input waits, idle, failure, stopped/ended, and unknown.
- Preserve provider-specific identifiers without copying transcripts or credentials.
- Work on macOS and Windows, the two Bitterless target platforms.
- Degrade safely when an application, CLI, hook, supervisor, or managed App Server is unavailable.

## Non-goals

- Reimplement the Codex or Claude conversation UI in Bitterless.
- Read or index conversation contents.
- Scrape provider SQLite databases, JSONL transcripts, process memory, or private Desktop IPC.
- Claim that an idle turn means the user's task is semantically complete.
- Focus an arbitrary existing terminal window by Accessibility/UI automation.
- Make locally observed, undocumented URL routes a production dependency.

## Verified provider capability matrix

Support levels:

- **Documented**: provider documentation defines the contract.
- **Versioned**: generated CLI schema or command output defines the installed-version contract.
- **Observed**: verified locally, but not a stable provider contract.
- **Unsupported**: deliberately excluded from the implementation.

| Provider surface | Discover/list | Open existing | Live status | Support and boundary |
|---|---|---|---|---|
| Codex Desktop task | Known IDs; App Server can list its thread store | `codex://threads/<thread-id>` | Exact only from the App Server instance that owns/loaded the task; hooks provide partial external observation | deep link documented; App Server documented/versioned |
| Bitterless-managed Codex App Server | `thread/list`, `thread/read` | same deep link, or resume through the managed client | `thread/status/changed`, `turn/started`, `turn/completed` | documented protocol; installed schema is versioned |
| External Codex Desktop/CLI task | hook events reveal IDs after setup | desktop deep link when the ID is known | lifecycle inferred from hook events; waiting-for-input is not fully observable | documented hooks, bounded observation |
| Claude Code CLI/Agent View background job | `claude agents --json`; optionally `--all` when supported | `claude attach <job-id>` in a terminal | `working`, `blocked`, `done`, `failed`, `stopped`; `waitingFor` may refine blocked | documented CLI; agent view is research preview; not Claude Desktop |
| Claude Code foreground CLI | live entries appear in `claude agents --json` with current `kind="interactive"`, `sessionId`, and `cwd`; legacy preview output may use `kind="foreground"` | do not auto-resume while its PID is alive; resume an inactive known session with `claude --resume <session-id>` | JSON listing has no runtime `state` for interactive/foreground entries; hooks provide bounded observation | documented CLI/hooks; local JSON shape verified |
| Claude Desktop chat/project | no local global listing contract | `claude://claude.ai/chat/<id>` or `/project/<id>` | no public local live-status API | documented links; status unsupported |
| Claude Desktop/Claude Code cloud session | no local global listing contract | `https://claude.ai/code/<session-id>`; `claude://code/<session-id>` is documented for mobile | no public local live-status API | universal link documented; custom existing-session route is not a Desktop contract |

Important distinctions:

- `claude-cli://open` starts a **new** terminal session with an optional prefilled prompt. It does
  not resume an existing CLI session.
- `claude://code/new` starts a **new** Claude Desktop Code session. It is not the resume route for a
  local CLI transcript.
- The locally accepted `claude://resume?session=...` route is undocumented and must not be used.
- A separately spawned Codex App Server can see stored task metadata but does not inherit the live
  in-memory ownership/state of the already-running Codex Desktop App Server.

## Local verification snapshot

The following checks establish the development baseline without making the versions permanent
requirements:

| Component | Verified behavior |
|---|---|
| ChatGPT/Codex Desktop `26.707.72221` | registers `codex://`; `codex://threads/<id>` opens the matching local task |
| Codex CLI `0.137.0` | generated schema includes `thread/list`, `thread/status/changed`, `turn/started`, `turn/completed`, and the status types below |
| Claude Code CLI `2.1.161` | `claude agents --json` returns live CLI entries; current foreground interactive entries use `kind="interactive"` and contain `sessionId` and `cwd` but no runtime `state`; this version rejects `--all` |
| Claude Desktop `1.21459.0` | registers `claude://`; existing local CLI resume remains a CLI operation, not a documented Desktop route |

Every adapter must probe capabilities at runtime. Versions in this table are evidence, not hardcoded
gates.

## Architecture

```text
Coding-agent Sessions renderer
              |
              | electron-xpc
              v
CodingAgentSessionXpcHandler (main)
              |
              v
CodingAgentSessionService
       |              |                  |
       v              v                  v
SessionRegistry   CodexAdapter       ClaudeAdapter
  (SQLite)        |      |           |      |       |
                  |      |           |      |       +-- hook events
                  |      |           |      +---------- agents --json poller
                  |      |           +----------------- terminal launcher
                  |      +----------------------------- hook events
                  +------------------------------------ managed App Server

Provider hooks/helpers
       |
       v
userData-derived local socket / named pipe
       |
       v
AgentSessionEventBridge -> normalizer -> registry -> XPC broadcast
```

The event bridge reuses the routing pattern established by the Todo MCP integration:

- Unix: an endpoint below the active application's `userData` directory.
- Windows: a named pipe whose suffix is derived from the same `userData` identity.
- Production, DEBUG, DEV, and DEV_DEBUG instances remain isolated.

The coding-agent event protocol and endpoint are separate from the Todo MCP protocol. A provider
helper is pinned to the exact endpoint that installed it; it never guesses which Bitterless instance
owns the event.

## Domain model

Keep the provider's conversation ID distinct from a Claude background supervisor job ID. They are
not interchangeable.

```ts
type CodingAgentProvider = "codex" | "claude";

type CodingAgentSurface =
  | "codex-desktop"
  | "codex-managed-app-server"
  | "claude-code-background"
  | "claude-code-cli"
  | "claude-desktop-chat"
  | "claude-desktop-code";

type CodingAgentRuntimeState =
  | "working"
  | "waiting_approval"
  | "waiting_input"
  | "idle"
  | "failed"
  | "stopped"
  | "ended"
  | "unknown";

type CodingAgentTurnState =
  | "in_progress"
  | "completed"
  | "interrupted"
  | "failed"
  | "unknown";

type CodingAgentStatusSource =
  | "codex-app-server"
  | "codex-hook"
  | "claude-agents-cli"
  | "claude-hook"
  | "manual"
  | "none";

interface CodingAgentSessionRecord {
  id: string;
  provider: CodingAgentProvider;
  surface: CodingAgentSurface;
  externalSessionId: string;
  runtimeJobId: string | null;
  title: string | null;
  titleIsCustom: boolean;
  cwd: string | null;
  state: CodingAgentRuntimeState;
  lastTurnState: CodingAgentTurnState;
  providerState: string | null;
  statusSource: CodingAgentStatusSource;
  statusObservedAt: number | null;
  statusFreshUntil: number | null;
  isProcessAlive: boolean | null;
  createdAt: number;
  updatedAt: number;
}
```

Do not persist an arbitrary URL, executable, or argument list. The main-process provider adapter
derives the open action from the validated `provider`, `surface`, IDs, and `cwd`.

### Identifier rules

- Accept UUID-shaped Codex and Claude conversation IDs where that provider route requires a UUID.
- Treat a Claude background job ID as an opaque, CLI-returned token with a conservative character
  allowlist; never substitute it for `externalSessionId`.
- Canonical uniqueness is `(provider, surface, external_session_id, delete_flag)`. Background job
  IDs are runtime references and may change when a conversation is re-hosted.
- Normalize paths with the operating system's path library and require an existing directory before
  using `cwd` to launch a process.

## Status normalization

Runtime state and turn outcome are separate. Runtime state answers "what does this session need
now?"; `lastTurnState` answers "how did the latest observed turn end?". The UI may render
`state=idle` plus `lastTurnState=completed` as **Turn complete**, but must not infer completion from
`idle` alone.

### Normalized semantics

| Bitterless state | Meaning | Must not imply |
|---|---|---|
| `working` | a turn/process is actively generating, using tools, or otherwise running | progress percentage or eventual success |
| `waiting_approval` | provider explicitly reports a permission decision is required | generic user input |
| `waiting_input` | provider explicitly reports a question/prompt is waiting for the user | approval |
| `idle` | session is loaded/alive and ready for another prompt | task completion |
| `failed` | provider reports an error terminal state for the observed run | conversation cannot be resumed |
| `stopped` | provider/user stopped the observed run | successful completion |
| `ended` | a session-end lifecycle event was observed | transcript deletion |
| `unknown` | no fresh authoritative or bounded observation is available | idle, complete, or offline |

| Last-turn state | Meaning |
|---|---|
| `in_progress` | a provider turn-start/submit event was observed and no terminal turn event followed |
| `completed` | the latest observed response/run completed successfully |
| `interrupted` | the latest observed response/run was cancelled or stopped |
| `failed` | the latest observed response/run ended with an error |
| `unknown` | no reliable latest-turn outcome is available |

### Provider mapping

| Provider evidence | Runtime state | Last-turn state |
|---|---|---|
| Codex App Server `active` with `waitingOnApproval` | `waiting_approval` | `in_progress` |
| Codex App Server `active` with `waitingOnUserInput` | `waiting_input` | `in_progress` |
| Codex App Server `active` with no active flags | `working` | `in_progress` |
| Codex App Server `idle` | `idle` | unchanged until a turn event resolves it |
| Codex App Server `systemError` | `failed` | `failed` when tied to the active turn; otherwise unchanged |
| Codex App Server `notLoaded` | `unknown` | `unknown` unless a retained terminal event exists |
| Codex `turn/started` or `UserPromptSubmit` hook | `working` | `in_progress` |
| Codex `PermissionRequest` hook | `waiting_approval` | `in_progress` |
| Codex `turn/completed` | `idle` | map installed-schema status: `completed`, `interrupted`, or `failed` |
| Codex `Stop` hook | `idle` | `completed` |
| Claude agent state `working` | `working` | `in_progress` |
| Claude agent state `blocked`, `waitingFor=permission prompt` | `waiting_approval` | `in_progress` |
| Claude agent state `blocked`, other/input reason | `waiting_input` | `in_progress` |
| Claude agent state `done` | `idle` | `completed` |
| Claude agent state `failed` | `failed` | `failed` |
| Claude agent state `stopped` | `stopped` | `interrupted` |
| Claude `UserPromptSubmit` hook | `working` | `in_progress` |
| Claude `PermissionRequest` or notification `permission_prompt` hook | `waiting_approval` | `in_progress` |
| Claude notification `idle_prompt` or `Stop` hook | `idle` | `completed` |
| Claude `StopFailure` hook | `failed` | `failed` |
| Claude `SessionEnd` hook | `ended` | unchanged |

`done` maps to runtime `idle` plus last-turn `completed`, not `ended`: the background task finished,
but its conversation remains attachable/resumable. Preserve `providerState="done"` for diagnostics.

### Freshness and precedence

Evidence precedence is:

1. Same-owner managed protocol (`codex-app-server`, `claude-agents-cli`).
2. Provider lifecycle hook.
3. Persisted manual metadata.

Rules:

- App Server status is fresh only while its initialized transport is connected.
- A complete, successful `claude agents --json` snapshot owns CLI process liveness only for its
  configured grace period. A valid interactive PID means live; a registered CLI conversation
  omitted from that complete snapshot means inactive for the same lease and may be resumed.
- A failed or partially invalid Claude snapshot never guesses that an omitted CLI process exited:
  foreground process liveness becomes `unknown`, while the persisted session metadata remains.
- Hook observations use a short lease. Terminal events (`failed`, `stopped`, `ended`) remain as the
  last observed result; non-terminal states become `unknown` when the lease expires.
- On Bitterless startup, every persisted non-terminal status and process-liveness observation begins
  as `unknown` until this service instance records new evidence. The implementation tracks
  same-millisecond refreshes explicitly rather than treating a persisted timestamp equal to startup
  time as current-process evidence.
- A missing hook heartbeat, application crash, machine sleep, provider update, or bridge outage is
  not evidence of completion.
- Store observation timestamps, not an artificial percentage.

## Codex adapter

### Open an existing task

The adapter builds the URL itself:

```text
codex://threads/<validated-thread-id>
```

The main process passes that URL to Electron's external URL opener. It does not accept a renderer-
supplied URL. If the URL scheme is unregistered or opening fails, show a recoverable action that
copies the task ID; do not silently create a new task.

### Managed App Server

Use a dedicated App Server process only for Codex work Bitterless intentionally manages:

1. Start the installed `codex app-server` over stdio by default.
2. Send `initialize`, then `initialized` exactly once for the connection.
3. Generate or vendor TypeScript schemas for the supported CLI version during development; validate
   runtime messages instead of accepting `any`.
4. Load an initial snapshot with `thread/list`/`thread/read`.
5. Apply `thread/status/changed`, `turn/started`, and `turn/completed` notifications.
6. Mark all managed statuses `unknown` when the transport exits, then reconnect with bounded
   exponential backoff.

Do not expose a non-loopback WebSocket listener. Stdio is the default because Bitterless owns both
ends and no bearer token or network port is needed.

### Existing Desktop/CLI tasks

A separate App Server must not be treated as the status authority for a task currently owned by
Codex Desktop. Local verification showed those stored tasks as `notLoaded` in the separate server,
including a task actively running in Desktop.

Offer an explicit **Install Codex status bridge** action that merges user-level Codex hook entries
for `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, and `Stop`. The helper receives JSON on
stdin and forwards only:

- `session_id`
- `cwd`
- `hook_event_name`
- `turn_id`, when present
- the permission/tool classification needed for normalization
- event timestamp and bridge installation ID

Do not forward `transcript_path`, prompts, tool arguments, outputs, or model responses. Codex
requires hook trust review; setup is not complete until the user has reviewed/trusted the exact
definition. Removal deletes only the Bitterless-owned hook entries and leaves unrelated hooks
untouched.

The hook bridge cannot currently distinguish every `waitingOnUserInput` condition. Such sessions
remain at their last bounded observation and eventually become `unknown`; they must not be shown as
authoritatively working forever.

## Claude adapter

### Discover and observe

Poll the allowlisted Claude Code CLI executable with an argument array and `shell: false`:

```text
claude agents --json
```

Validate the complete JSON result before using omission as process-liveness evidence. Background
entries provide a supervisor job ID and normalized `state`; a missing background PID is a valid
inactive observation. Current foreground interactive entries use `kind="interactive"`, must carry
a valid live PID, and provide no runtime state in the locally verified version. Accept legacy
preview `kind="foreground"` only as an explicitly tested compatibility alias. Foreground discovery
uses `statusSource="none"`, so it cannot outrank a lifecycle hook.

At startup, inspect `claude agents --help`. Append `--all` only when that installed version lists the
option; this allows newer CLIs to include completed background jobs while keeping `2.1.161`
compatible. The option probe is a CLI capability check, not version-string comparison.

Use a modest foreground refresh interval while the sessions surface is visible and a slower
background interval otherwise. Coalesce overlapping polls, cap output size, and enforce a timeout.
If the command fails, retain the discovered records but clear foreground process-liveness authority
to `unknown`; never turn a failed poll into an inactive/resumable verdict.

Refresh coalescing is keyed by provider and covers the complete discovery, merge, reconciliation,
and change-broadcast operation. Therefore `refresh()` and `refresh({ provider })` share the same
in-flight provider operation when they overlap; an older completion cannot replace newer liveness
evidence or emit a duplicate change broadcast.

Agent view is a research preview. Capability probing must check command support and field presence;
unknown fields are ignored and missing required fields produce `unknown`, not a guessed mapping.

### Open or attach

Choose one action from the validated record:

| Record | Action |
|---|---|
| Claude background job with `runtimeJobId` | open a terminal running `claude attach <job-id>` |
| inactive known local CLI conversation with `cwd` | open a terminal running `claude --resume <session-id>` |
| foreground interactive entry with live PID | show "Already open" and offer Copy resume command; do not start a second writer automatically |
| Claude Desktop chat/project | open the documented `claude://claude.ai/...` URL |
| Claude Desktop/cloud Code session | open `https://claude.ai/code/<session-id>`; let the OS/browser universal-link policy choose the app |

The official session documentation warns that resuming the same Claude conversation in two
terminals interleaves messages into one transcript. That is why a live foreground PID is not
auto-resumed.

The terminal launcher is a dedicated main-process service with two fixed templates:

- attach: `claude`, `agents`/`attach` arguments derived only from a validated job ID
- resume: `claude`, `--resume`, and a validated conversation ID, with validated `cwd`

It must not concatenate a shell command string from renderer data. Platform-specific terminal
creation belongs behind this service and requires packaged macOS and Windows integration tests.

### Foreground status bridge

Offer an explicit **Install Claude status bridge** action for foreground sessions. Merge only the
Bitterless-owned hook definitions into the user's Claude settings and subscribe to:

- `SessionStart`
- `UserPromptSubmit`
- `PermissionRequest`
- `Notification` for `permission_prompt` and `idle_prompt`
- `Stop`
- `StopFailure`
- `SessionEnd`

The helper forwards the same minimal envelope as the Codex helper. It does not read the supplied
`transcript_path`. Back up the settings file before the first merge, preserve unrelated settings and
hooks byte-for-byte where possible, and make install/remove idempotent. Claude handlers use the
documented exec form (`command` plus an argument array) on both platforms; this avoids shell
quoting and does not treat Claude Desktop as a status source.

Do not normalize Agent View's `agent_needs_input` or `agent_completed` notifications as foreground
hook state. They describe background jobs, and `agent_completed` may represent either success or
failure; background authority remains the validated `claude agents --json` snapshot.

## Local event bridge

Use a dedicated `AgentSessionEventBridge`; do not add hook ingress to the Todo MCP protocol.

Protocol requirements:

- Local Unix socket or Windows named pipe only; no TCP listener.
- Endpoint derived from the active `userData` identity and pinned into the installed helper.
- Length-prefixed or newline-delimited JSON with a strict maximum frame size.
- Envelope schema version, provider, installation ID, event ID, timestamp, and normalized minimal
  payload.
- Reject unknown providers, event types, oversized frames, invalid IDs, and endpoints owned by a
  different Bitterless profile.
- Acknowledge accepted events quickly; hook delivery must not block provider work on SQLite/UI
  latency.
- Deduplicate by `(installation_id, event_id)` before applying status.
- Queue in memory only for the short bridge-to-DAO gap. Provider sessions continue normally if
  Bitterless is not running.

Codex uses a generated shim under the active profile's `userData/bin`, matching the Todo MCP helper
lifecycle. Claude Code invokes the same Bitterless helper mode directly with exec-form arguments.
Both forms pin the profile endpoint and installation ID and contain no credentials. A current-build
hash/handler comparison must expose stale definitions as repairable after an app move or update.
Before writing the first backup, shim, or settings edit, persist pending ownership; interrupted
installs may resume or remove only while the recorded paths, immutable backup, and owned artifacts
still match.

## Persistence

Do not reuse the existing generic `session` table used by Bitterless chat features. Create a
separate table so provider/runtime semantics cannot leak into internal chat sessions.

```sql
CREATE TABLE coding_agent_session (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  surface TEXT NOT NULL,
  external_session_id TEXT NOT NULL,
  runtime_job_id TEXT,
  title TEXT,
  provider_title TEXT,
  custom_title INTEGER NOT NULL DEFAULT 0,
  cwd TEXT,
  state TEXT NOT NULL DEFAULT 'unknown',
  last_turn_state TEXT NOT NULL DEFAULT 'unknown',
  provider_state TEXT,
  status_source TEXT NOT NULL DEFAULT 'none',
  status_observed_at INTEGER,
  status_fresh_until INTEGER,
  is_process_alive INTEGER,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  delete_flag TEXT NOT NULL DEFAULT '0',
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, surface, external_session_id, delete_flag)
);
```

Deletion is soft: set `is_deleted = 1`, `deleted_at = now`, and
`delete_flag = String(Date.now())`. Default reads explicitly filter `is_deleted = 0`. This permits a
previously removed external session to be registered again without colliding with its tombstone.

`provider_title` stores the latest discovered name independently from the displayed `title`.
Provider refresh updates both only while `custom_title = 0`. `rename` sets `custom_title = 1`, even
when the requested title is `null`; therefore an explicit user rename or title clear survives every
later provider refresh. This precedence is represented by metadata and must not use `COALESCE`,
because `null` is a meaningful user override.

The legacy-table migration treats every row that existed before the `custom_title` column as
user-owned, including rows whose displayed `title` is `null`, because its original provenance is
unknowable. It detects that legacy state before adding the column and sets `custom_title = 1` only
for those existing rows. Re-running the migration helper after the column exists is a no-op for
ownership, so provider-owned rows created under the new schema are not reclassified.

Do not persist raw hook payloads. A small diagnostic ring buffer may hold redacted event names and
validation errors in memory; production logs must not include session prompts, transcripts, or
credential-bearing environment variables.

## XPC contract

All renderer calls go through `electron-xpc`. Each method takes zero or one object parameter:

```ts
interface CodingAgentSessionXpcHandler {
  list(params?: { includeUnknown?: boolean }): Promise<CodingAgentSessionRecord[]>;
  register(params: RegisterCodingAgentSessionParams): Promise<CodingAgentSessionRecord>;
  refresh(params?: { provider?: CodingAgentProvider }): Promise<RefreshResult>;
  open(params: { id: string }): Promise<OpenResult>;
  rename(params: { id: string; title: string | null }): Promise<CodingAgentSessionRecord>;
  remove(params: { id: string }): Promise<void>;
  getIntegrationStatus(params: { provider: CodingAgentProvider }): Promise<IntegrationStatus>;
  installStatusBridge(params: { provider: CodingAgentProvider }): Promise<IntegrationStatus>;
  removeStatusBridge(params: { provider: CodingAgentProvider }): Promise<IntegrationStatus>;
}
```

The main process broadcasts a narrow `coding-agent-session/changed` event containing affected
record IDs and a revision number. Renderers reload canonical records through `list`; broadcasts do
not carry provider hook payloads.

## Security and privacy

- Only the main process opens URLs or launches processes.
- Allowlist `codex:`, `claude:`, and exact `https://claude.ai/code/...` routes used by the adapter;
  reject credentials, fragments, unexpected hosts, and prompt/path query parameters for existing-
  session actions.
- Resolve `codex` and `claude` executables through an explicit detected configuration. Never execute
  a path supplied by the renderer or discovered in a project repository.
- Use `shell: false` for non-terminal probes. Terminal launching uses fixed, platform-reviewed
  templates and validated scalar arguments.
- Hook installation is opt-in, previewed, reversible, and limited to Bitterless-owned entries.
- Provider hook trust/permission prompts remain visible; Bitterless does not bypass them.
- No provider authentication token, transcript, prompt, tool input, or model output enters the
  Bitterless registry.
- Production and development helpers/endpoints remain isolated exactly like Todo MCP profiles.

## Failure behavior

| Failure | Required behavior |
|---|---|
| URL scheme missing | keep record; show install/retry and copy-ID actions |
| Codex managed App Server exits | mark its non-terminal statuses `unknown`; reconnect with backoff |
| Separate Codex App Server reports `notLoaded` | display `unknown`; do not override fresher hook evidence |
| Claude CLI missing or command unsupported | disable discovery/attach; retain manually registered records |
| `claude agents --json` timeout/invalid JSON | retain rows; set foreground process liveness to `unknown`; do not infer inactive or delete rows |
| Hook helper cannot reach Bitterless | exit quickly and successfully so provider flow is not blocked |
| Hook settings changed externally | report drift; require explicit repair instead of overwriting |
| Duplicate/stale event | ignore using event identity and observation timestamp |
| Resume target is already live | do not auto-resume; explain the duplicate-writer risk |

## Delivery plan

### Phase 1 - registry and safe opening

- Add the dedicated SQLite table/DAO/service and XPC contract.
- Add manual registration for a Codex task ID and known Claude session reference.
- Implement canonical Codex deep-link opening and validated Claude Desktop/universal links.
- Implement Claude Code CLI capability probing and read-only `agents --json` discovery, adding
  `--all` only when advertised.
- Show runtime state, last-turn outcome, status source, and freshness; default unobserved rows to
  `unknown`.

Exit gate: a known Codex task opens correctly, Claude discovery cannot execute arbitrary arguments,
and no provider-private file is read.

### Phase 2 - Claude background control

- Normalize documented Claude background states.
- Add the reviewed terminal launcher for `claude attach` and inactive `--resume` on macOS/Windows.
- Prevent automatic resume for live foreground sessions.

Exit gate: background jobs attach to the intended conversation; foreground duplicate-writer cases
are blocked by default.

### Phase 3 - lifecycle bridges

- Add the isolated socket/named-pipe event bridge and generated pinned helper.
- Implement idempotent Codex and Claude hook merge/remove flows.
- Add leases, precedence, drift reporting, and privacy-redacted diagnostics.

Exit gate: working/approval/idle transitions update without transcript access, stale states become
`unknown`, and unrelated provider settings survive install/remove byte-semantically unchanged.

### Phase 4 - optional managed Codex execution surface

- Add a stdio App Server supervisor for Bitterless-owned Codex tasks.
- Generate/validate version-matched schemas and consume status/turn notifications.
- Keep Desktop-owned tasks on the hook/deep-link path.

Exit gate: a managed task has authoritative same-owner status, while an independently active Desktop
task is never mislabeled from a separate server's `notLoaded` state.

This phase is deliberately deferred until Bitterless owns Codex execution. It is not an acceptance
gate for the external-session dashboard.

## Acceptance criteria

- A stored Codex ID always produces exactly `codex://threads/<validated-id>`.
- A missing provider or unavailable bridge never changes a session to `idle`/`ended`.
- Managed Codex status maps every installed-schema `ThreadStatus` variant.
- Claude background discovery maps every documented `state` and preserves unknown future values.
- Live foreground Claude sessions are not automatically resumed in a second terminal.
- Hook install/remove is idempotent and preserves unrelated Codex/Claude configuration.
- Hook payload tests prove prompts, transcript paths, tool arguments, and model output are discarded.
- Unix socket and Windows named-pipe endpoints are profile-isolated and reject oversized/invalid
  events.
- SQLite removal is soft and re-registration of the same provider session succeeds.
- macOS and Windows tests cover missing URL handler, missing CLI, successful open/attach, malformed
  provider output, bridge downtime, and app restart with stale persisted state.

## Sources

OpenAI:

- [ChatGPT desktop commands and Codex deep links](https://learn.chatgpt.com/docs/reference/commands.md)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server.md)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks.md)

Anthropic:

- [Launch Claude Code sessions from links](https://code.claude.com/docs/en/deep-links)
- [Manage Claude Code sessions](https://code.claude.com/docs/en/sessions)
- [Manage multiple agents with agent view](https://code.claude.com/docs/en/agent-view)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Open Claude Desktop with a link](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)
- [Open Claude mobile with a link](https://support.claude.com/en/articles/14898120-open-the-claude-mobile-app-with-a-link)

Provider documentation and installed CLI schemas are the compatibility sources of truth. Re-run the
capability probes and update this document before implementing against materially newer provider
versions.
