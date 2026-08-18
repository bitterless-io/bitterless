# EyesOnAgents Claude Observation

Status: Implemented; owner runtime and visual verification pending

Date: 2026-08-17

## Decision

Extend EyesOnAgents from a Codex-only board to a provider-aware local coding-agent monitor. The
existing Codex App Server, Codex Hook, Focus, unread, Domain, notification, and archive contracts
remain intact. Claude support is added beside them and does not revive the retired Home
`coding-agents` page.

The supported Claude scope is local Claude Code sessions visible on this computer, including CLI
sessions and local Claude Desktop Code sessions that expose the shared Claude Code transcript and
Hook surfaces. Claude.ai chat history and remote cloud sessions are not part of this delivery.

## Existing Codex synchronization

Codex keeps its current three-source reconciliation:

```text
active + archived thread/list inventory ─┐
App Server lifecycle notifications ──────┼─> provider-aware repository
trusted Codex Desktop Hooks ──────────────┘          │
                                                     v
                                      Domain + Focus + unread projections
```

- Full Connect, Refresh, activation, archive, and unarchive reconciliation page both active and
  archived `thread/list` inventories and retain raw source snapshots locally.
- App Server notifications apply same-owner lifecycle evidence.
- Trusted global Codex Hooks cover Codex Desktop/CLI lifecycle with content-free offline outbox,
  commit-only acknowledgement, and persistent receipt dedupe.
- One renderer-owned ten-second poll refreshes a 40-row hot page plus one round-robin cold page.
  It updates changed fields only and performs guarded newest-turn recovery for missed terminal or
  working evidence.
- SQLite owns raw inventory, Domain assignment, runtime evidence, unread, Focus, and Open markers.
- Codex archive is authoritative. A successful Open uses `codex://threads/<uuid>`, synchronizes the
  selected status, then acknowledges only a confirmed terminal task.

## Capability boundary

| capability | Codex | Claude |
|---|---|---|
| historical inventory | App Server `thread/list` | bounded Desktop metadata plus local transcript inventory |
| title/activity | App Server metadata | Desktop session metadata, Claude metadata entries, Agent View name, file mtime |
| foreground working | App Server owner or Codex Hook | Claude plugin Hook |
| background working | App Server owner | `claude agents --json --all` |
| missed terminal fallback | newest-turn App Server query | Agent View state; otherwise bounded stale-to-unknown |
| archive/unarchive | authoritative active/archived inventory | Desktop `isArchived`; CLI-only remains unknown |
| exact open | documented Codex deep link | observed Claude Desktop Session-ID route |
| transcript preview | prohibited | explicit read-only OnlyPreview action |

Claude CLI has no general archive/unarchive model and Claude Hooks contain no `Archive` or
`Unarchive` event. Claude Desktop does, however, persist one explicit top-level `isArchived` boolean
per local Code session under its application-support `claude-code-sessions/<account>/<org>/`
directory. The same metadata file carries both `sessionId` and `cliSessionId`, allowing the Desktop
row to join to the local JSONL identity without reading conversation content.

EyesOnAgents treats that Desktop file as a versioned, read-only provider adapter: a valid changed
file may set `active` or `archived`; malformed, missing, inaccessible, or future-schema files yield
no new archive evidence. A missing Agent View row or JSONL file is still not archive evidence: it
can also mean an inactive foreground process, retention cleanup, or an unavailable provider.
CLI-only rows with no matched Desktop metadata therefore remain `archiveState = "unknown"` and
visible in All. A Claude plugin cannot close that residual gap; it observes lifecycle only and never
patches Claude Desktop internals or treats an unrelated Hook as archive evidence.

## Architecture

```text
                          ┌─ Codex App Server + Codex Hook bridge
EyesOnAgents service ─────┤
                          └─ Main-owned Claude observation singleton
                             ├─ local socket / named-pipe receiver
                             │       ^
                             │       └─ standalone Node directory watcher
                             ├─ Desktop metadata + JSONL reconciliation
                             ├─ Agent View poll
                             └─ plugin Hook bridge
                                      │
                                      v
                         provider-aware SQLite repository
                                      │
                                      v
                       Focus / All / Domain / title search
```

Provider adapters may update only their own rows and status sources. A Claude failure never
invalidates Codex state; a Codex connection failure never invalidates Claude state. The existing
single ten-second renderer interval invokes one coalesced service refresh, but each provider has an
independent in-flight fence and result.

## Claude provider preference

Claude support has one Main-owned persisted provider switch. The value uses the existing Core
`setting` table at `eyes_on_agents / claude_provider_v1`:

```ts
interface EyesOnAgentsClaudeProviderPreference {
  schemaVersion: 1;
  enabled: boolean;
  hookAdmissionAfter: number | null;
}
```

A missing value defaults to enabled so an upgrade preserves the existing Claude behavior. A
malformed value fails closed to disabled and exposes one bounded error in the Claude connection
card; toggling the switch replaces it with a valid exact schema. Renderer XPC sends only one strict
boolean intent and cannot select a provider, path, command, plugin, or session.

Turning Claude support off is a provider pause, not a destructive removal:

1. persist `enabled: false`, close Hook intake, and fence the current Claude lifecycle;
2. stop and join the Hook listener, directory watcher, scans, background refresh, and Main retry;
3. force-expire active Claude runtime authority and clear the Bitterless-owned bounded Claude Hook
   outbox so disabled-period events cannot become later unread/completion notifications;
4. omit Claude rows from the returned snapshot while retaining every SQLite row, Domain, unread,
   archive, Open marker, directory preference, plugin installation, and receipt.

Turning support on first persists `enabled: true` with `hookAdmissionAfter` set to the reserved
`Number.MAX_SAFE_INTEGER` pending-admission sentinel. Main then clears the owned outbox, captures a
finite admission boundary, persists that final cutoff through the same serialized intent path,
starts directory observation with the saved directory, performs a full refresh, and resumes the
Hook listener only when the existing Bitterless plugin installation remains valid. A restart that
reads the pending sentinel repeats cleanup and finalization before admitting any source. A delayed
live/outbox delivery at or older than the finite cutoff receives a
duplicate-style committed acknowledgement so the helper can delete it, but never writes inventory,
runtime, delivery/completion receipt, observation proof, unread, broadcast, sound, or notification.
This closes the race where an already-running helper writes an old event after the outbox was
cleared. The persisted cutoff also closes a crash between preference persistence and cleanup: a
restart still ACK-drops every disabled-period event. Missing/default-on state has a null cutoff, and
ordinary enabled App restart/auth resume never advances it or clears valid offline events. A failed
source start does not roll the preference back; directory and plugin management remain available as
recovery actions without advancing the finite cutoff or clearing enabled-period backlog. The plugin
is never installed, removed, enabled, or disabled merely by changing the provider switch.

The Hook socket starts unarmed. It drains coverage evidence and the durable outbox before live
admission; a live frame arriving at that boundary receives no acknowledgement and is durably
replayed ahead of later live work. Admission requires an empty durable backlog; a failed consume or
file removal leaves the delivery recoverable and keeps the listener unarmed. A pre-cutoff coverage
marker may be ignored by the service and still allow admission, while a current gap revokes intake
and keeps that listener unarmed. Provider setting reads and writes share one short serialization
boundary, and App/auth generations fence delayed writes from reviving an obsolete runtime. Snapshot
projection carries a Main-owned monotonic provider revision; Main rebuilds snapshots whose revision
changes during an asynchronous read, and the renderer rejects a late response older than the newest
revision it has applied.

Every Claude-specific Main action rejects while the provider is off. Read all is provider-scoped so
hidden Claude unread rows are not acknowledged. Codex App Server, Codex Hook, auto-connect, hot/cold
polling, last-question capture, Open, unread, notification, and archive behavior do not read or
mutate the Claude preference.

## Claude directory lifecycle and configuration

Claude inventory configuration is Main-owned and independent from Claude Hook installation. The
user configures the Claude **config directory** (normally `~/.claude`), not an individual project or
JSONL file. Main derives the transcript inventory root as `<config-directory>/projects`; Claude
Desktop metadata directories remain platform-owned automatic sources.

```text
Core SQLite ready
       │
       v
hydrate directory intent ── invalid ──> visible error; watcher remains stopped
       │ valid/missing
       v
resolve automatic/custom root ──> one ready watcher helper ──> full inventory scan
       ^                                                        │
       └──────── Main-owned bounded retry when unhealthy ───────┘
```

The persisted value uses the existing Core `setting` table at
`eyes_on_agents / claude_directory_v1`:

```ts
interface EyesOnAgentsClaudeDirectoryConfig {
  schemaVersion: 1;
  mode: "automatic" | "custom";
  configDirectory: string | null;
}
```

- A missing value means `automatic`. Automatic mode uses an absolute `CLAUDE_CONFIG_DIR` inherited
  by the GUI process when valid, otherwise the user's `~/.claude` directory.
- Custom mode stores one canonical absolute directory selected by Main through the native directory
  picker. It must be an existing regular directory, not a symlink. The `projects` child may be
  absent; that is a recoverable waiting state so a later Claude session can create it.
- A malformed persisted value never silently selects another directory. Observation stays stopped
  with a bounded error until **Use automatic** or a new directory selection replaces it.
- Renderer XPC contains only parameterless **Change directory**, **Use automatic**, and **Retry**
  intents. It never supplies a path, URL, provider command, or transcript target.
- Setting persistence must succeed before the applied runtime changes. After success, one serialized
  lifecycle fences the old scan, stops the old helper/socket, clears stale Claude transcript-path
  and transcript-activity capabilities, applies the new root, starts and admits one ready helper,
  then performs one full scan. Thread identity, title, Domain, unread, archive, and runtime history
  remain intact.
- Preview revalidates against the currently applied config root. It never re-reads a stale process
  environment after a custom directory is active.

The Main singleton, not the EyesOnAgents renderer, owns recovery. When the projects directory is
missing or watcher setup/scan fails, exactly one unref'ed retry timer uses delays
`1s -> 5s -> 15s -> 30s -> 60s`, capped at 60 seconds. A retry re-resolves roots and starts a full
scan only when the source becomes usable; it is not a second steady-state inventory poll. Healthy
inventory still uses socket invalidation plus the existing renderer-triggered ten-second
reconciliation. Logout, auth suspension, configuration replacement, and app quit cancel the timer
and fence every older callback before stopping the child and local socket.

Watcher admission requires one exact, content-free IPC `ready` frame sent only after the helper has
installed every `fs.watch`; Main starts the full scan only after that handshake. A watcher error is
fatal to that helper generation: it closes every watcher and exits non-zero so the Main-owned retry
can rebuild the helper. Child, socket, and cleanup generations are fenced, so a delayed ready/exit
or old socket close cannot admit, stop, unlink, or downgrade a newer healthy watcher.

Snapshot status is runtime-only except for the configuration intent:

```ts
interface EyesOnAgentsClaudeDirectoryStatus {
  mode: "automatic" | "custom";
  configuredDirectory: string | null;
  effectiveDirectory: string | null;
  projectsDirectory: string | null;
  desktopDirectoryCount: number;
  state: "starting" | "watching" | "waiting" | "degraded" | "retrying" | "error" | "stopped";
  watching: boolean;
  lastScanAt: string | null;
  lastSuccessfulScanAt: string | null;
  nextRetryAt: string | null;
  error: string | null;
}
```

Status changes broadcast only when a field actually changes. Absolute config paths are exposed only
for this explicit local configuration surface; individual transcript paths remain Main-private.
The generic setting DAO must not log setting values, because the persisted directory is local user
metadata.

## Provider identity and migration

`thread_id` is a provider-owned identifier, not a globally safe primary key. Every normalized row
has:

```ts
type EyesOnAgentsProvider = "codex" | "claude";
type EyesOnAgentsSessionKey = `${EyesOnAgentsProvider}:${string}`;

interface EyesOnAgentsThreadIdentity {
  sessionKey: EyesOnAgentsSessionKey;
  provider: EyesOnAgentsProvider;
  threadId: string;
}
```

SQLite uses `session_key` as its internal primary key and enforces
`UNIQUE(provider, thread_id)`. Snapshot, Hook delivery, completion-alert, Domain move, Open, refresh,
search selection, drag-and-drop, and loading state all use this provider-qualified identity.
Renderer calls never supply a URL, executable, transcript path, or command.

The migration is transactional and idempotent:

1. Rebuild provider-blind EyesOnAgents tables into provider-aware tables.
2. Convert every existing row and receipt to provider `codex` with
   `session_key = "codex:" || lower(thread_id)`.
3. Preserve Domain IDs, archive, runtime, unread, prompt permission data, timestamps, raw snapshots,
   and alert receipts exactly.
4. Import still-active legacy Claude rows from `coding_agent_session` only when no normalized Claude
   row exists; never drop or rewrite that legacy table.
5. An empty database and every retained older fixture must migrate to the same final schema.

## Claude inventory

### Desktop session metadata

The macOS source root is `~/Library/Application Support/Claude/claude-code-sessions`; equivalent
platform application-support roots are resolved by Main. Discovery accepts only the exact shape
`<account-uuid>/<org-uuid>/local_<desktop-uuid>.json`, regular files below the canonical root, and a
fixed file-size cap. It projects only:

```text
sessionId, cliSessionId, title, cwd,
createdAt, lastActivityAt, isArchived
```

`cliSessionId` is the canonical Claude identity when present; the validated `local_...` Desktop ID
is retained as `desktopSessionId` for Desktop routing. New or mtime-changed files are parsed
with bounded concurrency. The adapter never persists the raw object, scans unrelated Claude app
storage, or reads prompt/message/permission/configuration fields. A valid explicit `isArchived`
transition is authoritative for that matched Desktop session and is reconciled on the ten-second
poll, window activation, and manual Refresh.

### Local transcript inventory

The inventory root is `${CLAUDE_CONFIG_DIR}/projects` when `CLAUDE_CONFIG_DIR` is an absolute path,
otherwise `~/.claude/projects`. Discovery accepts only a direct project child file named exactly
`<uuid>.jsonl`; nested subagent transcripts are excluded.

Inventory work is content-minimal:

- directory enumeration and file `stat` discover IDs and reliable activity time;
- monitoring never opens or parses JSONL content; titles and working metadata come only from the
  bounded Desktop metadata and Agent View adapters;
- malformed or future JSONL entry shapes therefore cannot place prompt, reply, tool, attachment, or
  other conversation bytes in Main memory, SQLite, XPC, logs, or notifications;
- the transcript path is stored only for the explicit preview/open adapter and never sent to the
  renderer;
- raw transcript JSON is never copied into SQLite snapshots.

The inventory treats the JSONL entry schema as opaque provider content. A valid UUID filename plus
file metadata admits a session even when title, cwd, or surface cannot be recovered. Active
`claude agents` names may repair a missing title. Existing non-empty titles are not erased by an
incomplete refresh.

## Claude runtime reconciliation

### Agent View polling

The allowlisted Claude executable is invoked with argument arrays and `shell: false`:

```text
claude agents --help
claude agents --json [--all only when advertised]
```

Interactive rows discover process presence, name, cwd, and start time. A missing interactive
`state` is not treated as idle. Background rows normalize supported `working`, `blocked`, `done`,
`failed`, and `stopped` states; an unknown future value becomes `unknown`.

A successful complete Agent View snapshot may reconcile background rows omitted from `--all`, but
must not classify omitted ordinary interactive history as archived or deleted. A failed, partial,
oversized, or malformed command preserves persisted rows and changes no terminal/archive evidence.

### Claude plugin Hooks

Bitterless ships one versioned user-scope Claude Code plugin containing only lifecycle Hooks and a
content-free helper. It is installed from a Bitterless-owned local marketplace through fixed Claude
CLI arguments. This avoids editing or replacing existing `~/.claude/settings.json` Hook arrays.

| Hook | normalized transition |
|---|---|
| `SessionStart` | discover/update metadata; no fabricated working state |
| `UserPromptSubmit` | `working`, unread, current-state start time |
| `PermissionRequest` | `waiting_approval`, unread |
| `Stop` | `idle`, completed, unread, completion alert candidate |
| `StopFailure` | `failed`, unread, completion alert candidate |
| `SessionEnd` | `ended` only when no newer active evidence exists |

The helper accepts the common `session_id`, `transcript_path`, `cwd`, and event name, plus bounded
classification fields needed above. It always discards prompt, last assistant message, tool input,
tool output, attachment, and model content. It follows the Codex bridge reliability model: local
profile socket/named pipe, content-free bounded outbox, commit-only ACK, and persistent delivery
receipt.

Claude does not emit `Stop` when the user interrupts a foreground response. Non-terminal Claude
Hook evidence therefore has a bounded freshness lease. Agent View evidence can settle background
work; otherwise an expired foreground state becomes `unknown` while retaining unread attention. It
never becomes `idle` or completed merely because time passed.

Plugin installation and observation are separate facts. One Bitterless action owns marketplace
registration, installation, and enablement: after install it inspects the exact user plugin and runs
`plugin enable` only when Claude reports it disabled. An already-enabled plugin is success.

The bridge also recognizes its strict interrupted-setup checkpoint. **Finish setup** uses the same
fail-closed Repair boundary: after exact ownership proof it stops intake, clears only the owned
setup-period outbox, rotates the installation ID, reinstalls the exact user plugin, verifies its
enabled state, and starts the new listener generation. It does not treat pre-commit deliveries as
observation proof because plugin-management probes can emit them while setup is incomplete. Any
ownership ambiguity remains a fail-closed Repair/error state.

An already-open Claude Code or Desktop Code session does not dynamically load a newly installed
plugin. Bitterless therefore offers Anthropic's published `claude://code/new` route as the primary
one-click way to open a fresh Desktop Code session, plus a copyable `/reload-plugins` action for the
current session. It automatically updates after the first committed lifecycle event. Bitterless
cannot execute a slash command inside an existing Claude Desktop session through a supported
external API. `/hooks` is secondary
troubleshooting, not a normal enable step or observation proof. Workspace trust may still withhold
Hooks; the first committed event is the only proof that observation is active. Remove plugin
removes only the Bitterless-owned plugin installation/local marketplace and leaves every other
Claude plugin, Hook, setting, and transcript intact.

## Archive semantics

```ts
type EyesOnAgentsArchiveState = "active" | "archived" | "unknown";
```

- Codex full inventory and archive notifications own `active`/`archived`.
- A matched, valid Claude Desktop metadata file owns `active`/`archived` for that session.
- A Claude CLI-only session uses `unknown`.
- All and custom Domains exclude only explicit `archived`; `unknown` remains visible.
- Focus is still active runtime OR unread and is independent from unknown archive capability.
- No provider omission, file deletion, retention cleanup, Hook, SessionEnd, or process exit may
  create Claude `archived` evidence; only a parsed explicit Desktop `isArchived: true` may do so.

## Open and transcript preview

Main derives all targets from a persisted provider-qualified row.

| Claude evidence | primary Open |
|---|---|
| matched Desktop metadata | observed `claude://claude.ai/epitaxy/<desktopSessionId>` |
| CLI-only JSONL with no Desktop metadata | no interactive Open; Preview transcript only |

The Desktop route launches the Claude Desktop UI and never starts Claude CLI. It is verified against
the installed Claude Desktop but is not a published Anthropic contract. `shell.openExternal`
success proves only that the OS accepted the scheme, not that Claude rendered the intended session.
UI copy and return types must not claim stronger evidence. The feature deliberately does not use
`claude://resume`, because that route imports a CLI transcript and may unarchive an existing Desktop
session as a side effect. `claude://code/<id>` is also excluded because the installed handler accepts
only server/bridge identifiers rather than local Session IDs.

Every Claude card also exposes **Preview transcript** when its canonical JSONL path is
available. Main passes that stored path directly to the existing OnlyPreview absolute-target
service after revalidating that it is the same regular UUID transcript below the configured Claude
projects root. Preview is explicit and read-only; it may reveal the complete local conversation and
never marks the task read. Existing OnlyPreview text-size limits still apply; an oversized JSONL
returns its normal bounded error instead of raising the global limit or loading an unbounded
conversation into memory. This delivery does not launch `claude --resume`, `claude attach`, a
terminal, or any other CLI interaction from Open.

Codex Open and unread acknowledgement behavior is unchanged. Claude Open performs no provider RPC;
after the OS accepts the fixed route it marks a confirmed terminal row read, while an active or
unknown row remains in Focus.

## Refresh budget

One Main-owned Claude observation singleton starts with Bitterless and is shared by every renderer.
It owns a profile-local Unix Domain Socket (Windows: Named Pipe) and supervises one standalone Node
directory-watcher helper. The helper exposes no HTTP/TCP interface, never parses or transmits
conversation bodies, and sends only bounded invalidation frames identifying Desktop metadata or
transcript inventory as changed. Main validates each frame, coalesces bursts, and performs the
canonical bounded scan and SQLite commit. The helper runs with Electron's Node mode and therefore
creates no second Electron application or Dock icon.

The existing ten-second interval remains the reconciliation fallback; the service coalesces
concurrent socket/activation/manual/poll requests:

1. Run the Codex 40-row hot page and current cold page exactly as today.
2. Enumerate Claude Desktop session metadata and transcript filenames/stat metadata; parse only a
   bounded 40 changed/new files from each source in recency order, rotating remaining changes.
3. Run one coalesced `claude agents --json --all` capability-aware probe.
4. Persist only field-level differences and broadcast only when at least one provider row changed.

Manual Refresh and window activation run full provider discovery. Failure from one provider is
reported in its connection section and does not roll back the successful provider.

The supervisor does not treat process spawn as watcher readiness. It waits for the helper's strict
content-free ready frame after all source watchers exist; malformed/stale ready frames are ignored.
Filesystem watcher errors terminate that generation and flow through the same Main retry path.

## UI contract

Each card shows a compact provider glyph before the title: OpenAI/Codex knot for Codex and a Claude
asterisk for Claude. The glyph has a tooltip and accessible label, consumes no new card row, and is
the only new card decoration. It uses muted provider color and does not compete with working/unread
signals.

The Connection drawer has three background-separated sections: Codex App Server, Codex observation,
and Claude observation. A compact small switch in the Claude header owns provider support. When it
is off, the card retains only its header and one neutral explanation that Claude observation and
task display are paused while Codex continues normally. When it is on, one setup action is derived
from strict state: Enable, Finish setup, Open new Claude session, Retry listener, or Repair. An
exact installed plugin with a stopped local listener is labelled **Listener paused**, never
Awaiting activity; retry failure remains visible. Check status remains a secondary diagnostic and
Remove plugin remains available for the owned installation. A successful reload-command copy
changes to **Copied** and announces that result. There is no
always-visible setup guide; `/hooks` appears only under the collapsed **Still not working?**
diagnostic. The card does not show Codex trust language for Claude and adds no new border or row.

Global search, All, Focus, and custom Domains contain both providers and keep the established
attention comparator. Search selection and Open loading use `sessionKey`, so a provider update
cannot redirect an in-flight click to a different card.

## XPC additions

Existing semantic methods remain and become provider-qualified where they address a row:

```text
openThread({ sessionKey })
previewClaudeTranscript({ sessionKey })
moveThread({ sessionKey, domainId })

getClaudeBridgeStatus()
installClaudeBridge()
refreshClaudeBridgeStatus()
removeClaudeBridge()
openNewClaudeSession()
copyClaudeReloadCommand()
setClaudeProviderEnabled({ enabled })
```

No XPC accepts an arbitrary provider name, URL, file path, executable, command, Hook definition, or
Claude CLI argument.

## Privacy and safety

- Claude prompt/message capture is not authorized by the Codex latest-question preference.
- JSONL inventory reads no file content; raw text and payloads do not enter SQLite, XPC, logs,
  notifications, search, or crash diagnostics.
- Transcript preview is a separate user action and displays the source file without persisting a
  second copy.
- Provider executable and filesystem roots are main-owned and allowlisted.
- Existing Claude settings, Hooks, plugins, and legacy rows are preserved.
- Unknown provider variants fail closed to `unknown`; fallback never silently claims success.

## Acceptance

- Every existing Codex repository, App Server, Hook, archive, unread, Open, poll, and notification
  contract still passes with provider `codex`.
- Missing provider preference defaults to Claude enabled; an invalid value is visible and
  fail-closed. Turning it off stops every Claude runtime/retry/intake path, hides Claude from Focus,
  All, Domains, project filters, and title search, and leaves Codex synchronization unchanged.
- Turning Claude support back on restores the saved rows and annotations, performs fresh inventory,
  resumes an already-installed valid plugin, and never replays disabled-period Hook events.
- Read all while Claude is disabled acknowledges Codex only; hidden Claude unread state remains.
- Empty and multi-version databases migrate to provider-qualified keys without losing annotations.
- A new or renamed local Claude session appears after Refresh and after the ten-second bounded poll.
- Claude Hook start/stop/failure transitions update Focus/unread and dedupe across offline replay.
- A foreground interrupt cannot remain authoritatively working after its lease; it becomes unknown,
  not completed.
- A matched Desktop `isArchived` transition hides/restores the Claude row within one poll; a
  CLI-only row remains unknown and omission/deletion never hides it.
- Codex and Claude cards have distinct accessible provider icons.
- Claude Open builds only the fixed validated `epitaxy` Desktop route when `desktopSessionId` exists
  and never launches CLI; transcript preview opens only the
  persisted canonical JSONL through OnlyPreview.
- Plugin setup owns marketplace registration, install, and enablement; an install that already
  enabled the exact user plugin skips redundant enable, while an exact disabled plugin is enabled
  and re-inspected. Interrupted setup exposes Finish rather than a dead end. Remove preserves all
  unrelated Claude settings and plugins.
- Missing directory configuration hydrates automatic mode; a valid custom directory persists across
  logout/login and App restart, starts without opening EyesOnAgents, and can return to automatic.
- A directory change immediately fences the old scan, restarts exactly one watcher, clears only old
  transcript Preview capability, and keeps every thread annotation and attention state.
- A missing projects child or watcher failure recovers through one Main-owned bounded retry even
  while the EyesOnAgents window is closed; shutdown prevents every delayed respawn.
- A full scan begins only after a content-free helper-ready handshake; filesystem watcher failure
  closes that generation, and delayed old-child/socket cleanup cannot affect its replacement.
- Connection UI shows the effective directory, automatic/custom mode, watcher state, last successful
  scan, next retry, and bounded error without exposing any individual transcript path.
- Repository, migration audit, core, bridge, UI-source, typecheck, and production build checks run
  without launching Electron windows.

## Sources

- [Claude Code sessions](https://code.claude.com/docs/en/sessions)
- [Claude Agent SDK session metadata](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Agent View](https://code.claude.com/docs/en/agent-view)
- [Claude Code deep links](https://code.claude.com/docs/en/deep-links)
- [Claude Desktop shared configuration](https://code.claude.com/docs/en/desktop#shared-configuration)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins-reference)
