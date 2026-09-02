# EyesOnAgents Claude Multi-Environment

Status: Draft

Date: 2026-09-02

## Decision

Extend Claude observation from exactly one configured Claude config directory
(`CLAUDE_CONFIG_DIR`, normally `~/.claude`) to N independently-managed named **environments** — a
user who runs a wrapped `claude2`/`claude3` shell command against a second/third
`CLAUDE_CONFIG_DIR` gets that environment's sessions discovered, hook-observed, and Open-routed the
same way the default environment already is. This supersedes the single-`configDirectory` model
described in [EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md)'s "Claude
directory lifecycle and configuration" section; that section is edited in place (task 084) to point
here rather than duplicating a now-superseded contract.

This also subsumes the earlier, narrower "add iTerm2 configuration guidance to Agent Connections"
request: the concrete guidance a user needs is "how do I add and install a second Claude
environment," which is exactly this feature's renderer surface (task 088).

## Scope decisions (why the design is shaped this way)

Two axes are easy to conflate and must stay separate:

- **Bitterless runtime profile** (`production` / `production-debug` / `test-debug` / `test-release`)
  — which Bitterless build is running, already documented in
  [EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md)'s Claude plugin Hooks
  section. Unchanged by this feature.
- **Claude environment** (this feature) — which `CLAUDE_CONFIG_DIR` a `claude` invocation targets.
  Orthogonal to the profile axis: one Bitterless profile now supervises N Claude environments.

Within one Bitterless profile, every environment's installed plugin shares the **same**
`installationId`, socket endpoint, and outbox — this feature does not touch the plugin bridge's
existing single-installation continuity/rotation state machine
([EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md)'s Claude plugin Hooks
section describes it in detail; it is one of the most invariant-dense parts of this codebase and is
explicitly out of scope for this delivery). Installing "for an environment" only changes which
`CLAUDE_CONFIG_DIR` the `claude` CLI runs against while installing/enabling/removing the plugin —
every environment's hook definition still calls the same helper with the same
`{endpoint, installationId, outboxPath}` args. Consequence: this delivery does not give per-environment
delivery admission/coverage isolation — a coverage gap or outbox corruption still affects the whole
profile, not one environment. That stronger isolation is a real possible future increment, not this
one; it is recorded as a non-goal below and a backlog note.

The JSONL/Desktop **directory watcher**, by contrast, gets full per-environment process isolation
(see "Watcher" below) — that boundary is cheap (the supervisor already spawns one child process per
call site) and matches this codebase's established philosophy that one provider/source's failure
must never invalidate another's state.

## Data model

`src/shared/eyesOnAgents/eyesOnAgents.type.ts`'s `EyesOnAgentsClaudeDirectoryConfig` moves from a
single scalar to an array, as `schemaVersion: 2`:

```ts
interface EyesOnAgentsClaudeEnvironment {
  id: string;                        // stable, generated once at creation (uuid)
  label: string;                     // user-facing name, e.g. "Default", "claude2"
  mode: 'automatic' | 'custom';
  configDirectory: string | null;    // absolute custom directory; null when mode is 'automatic'
  enabled: boolean;
}

interface EyesOnAgentsClaudeDirectoryConfig {
  schemaVersion: 2;
  environments: EyesOnAgentsClaudeEnvironment[]; // always at least one entry
}
```

> **Implementation note (task 084):** the shared type file keeps the name
> `EyesOnAgentsClaudeDirectoryConfig` for this schemaVersion 2 shape rather than introducing a
> separate `...V2` type name — the old schemaVersion 1 scalar shape has no exported type of its own
> any more (it only exists as a private, read-only shape inside `claudeDirectoryConfig.service.ts`
> for parsing a legacy persisted value during migration). Every consumer that used to import
> `EyesOnAgentsClaudeDirectoryConfig` for the old scalar (`claudeObservation.service.ts`) was
> updated to key off a single `EyesOnAgentsClaudeEnvironment` instead — see "Watcher" below.

Rules:

- Only ONE environment may ever have `mode: 'automatic'` (there is exactly one ambient ecosystem
  default — an unset `CLAUDE_CONFIG_DIR` — so "automatic" for a second environment is meaningless).
  By convention it is `environments[0]`; it can be renamed and its mode/configDirectory changed
  like any environment. **Implementation note (task 084):** `removeEnvironment` enforces only that
  the list can never become empty — it does not specifically pin `environments[0]` against removal.
  Removing the current `environments[0]` (while at least one other environment remains) promotes
  the next entry into that slot, which then becomes the one environment eligible for
  `useAutomatic`.
- Every added environment is created with `mode: 'custom'` and a caller-supplied
  `configDirectory` — there is no second ambient variable to default to.
- `id` is stable across renames/directory changes; nothing else in this feature keys on `label` or
  `configDirectory` as an identity.
- **Recovery from an invalid or not-yet-hydrated persisted value.** The pre-084 single-directory
  contract let **Change directory** and **Use automatic** unconditionally replace a malformed saved
  value ([EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md): "Observation stays
  stopped with a bounded error until Use automatic or a new directory selection replaces it").
  `chooseCustomDirectory`/`useAutomatic` preserve this: when the service has no currently-hydrated
  environment list (a fresh install that never persisted, or a saved value that failed to parse),
  both methods ignore the given `id` and instead reset to one freshly-generated single environment
  (custom with the picked directory, or automatic) — exactly mirroring the old recovery contract.
  Once a valid list exists, both methods require a real, currently-known `id`.

**Migration.** Reading a persisted `schemaVersion: 1` value
(`{mode, configDirectory}`) converts it once into
`{schemaVersion: 2, environments: [{id: <fresh-uuid>, label: 'Default', mode, configDirectory,
enabled: true}]}` and persists the converted value, matching this project's existing "read old
shape, write new shape once" migration convention (e.g. the provider-preference and archive-state
migrations in [EyesOnAgents Integration](../integrations/eyes-on-agents.md)). A missing value (fresh
install) hydrates the same single default `automatic` environment as today — zero behavior change
for a user who never opens the new "Add environment" action.

`ClaudeDirectoryConfigService` (`src/main/eyesOnAgents/claudeDirectoryConfig.service.ts`) gains:

```text
listEnvironments() -> EyesOnAgentsClaudeEnvironment[]
addEnvironment({ label, configDirectory }) -> EyesOnAgentsClaudeEnvironment   // always mode: 'custom'
renameEnvironment({ id, label })
removeEnvironment({ id })          // rejects removing the last remaining environment
setEnvironmentEnabled({ id, enabled })
chooseCustomDirectory({ id })      // opens the existing native picker, sets that environment's directory
useAutomatic({ id })               // only valid for the one environment allowed to be automatic
```

Persisted at the same setting key (`eyes_on_agents / claude_directory_v1`); only the JSON shape
changes. The generic setting DAO must continue not to log setting values (unchanged rule from
[EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md) — a `configDirectory` is
local user filesystem metadata).

**Logging.** Every environment lifecycle mutation (add/rename/remove/enable/disable, and mode
changes) logs one `[claude-environment]` line through the existing `electron-log` main-process
logger described in [Application Logging and Diagnostics](application-diagnostics.md) — `id` and
`label` may appear, `configDirectory` never does (mirrors the existing environment-variable
presence-only convention: log that a directory was set/changed, never its value).

## Watcher

`ClaudeObservationService` (`src/main/eyesOnAgents/claudeObservation.service.ts`) moves from one
`appliedConfig`/`generation`/`status`/`ClaudeWatcherSupervisor` to a map keyed by environment `id`,
each entry independently owning its own `appliedConfig` (one environment), `generation` fence,
`ClaudeWatcherSupervisor` instance (one child process, its own `--claude-inventory-root` args
resolved from that one environment's `desktopRoots`/`projectsRoot`), and its own
`1s -> 5s -> 15s -> 30s -> 60s` bounded retry timer. Adding/removing/enabling/disabling an
environment starts or stops only that environment's supervisor; every other environment's watcher,
generation, and retry state is untouched — this mirrors the existing "a Claude failure never
invalidates Codex state" isolation one level deeper, between Claude environments themselves.

A disabled environment has no running supervisor and reports `state: "stopped"`; this is a
deliberate manual pause, not a failure, and never enters the retry ladder.

`EyesOnAgentsClaudeDirectoryStatus` becomes `EyesOnAgentsClaudeEnvironmentStatus[]`, one entry per
configured environment, each carrying the existing fields (`mode`, `configuredDirectory`,
`effectiveDirectory`, `projectsDirectory`, `desktopDirectoryCount`, `state`, `watching`,
`lastScanAt`, `lastSuccessfulScanAt`, `nextRetryAt`, `error`) plus `id`, `label`, and `enabled`.

> **Implementation note (task 085):** when the persisted directory configuration itself fails to
> hydrate (malformed value, or a thrown read error), no environment identity is known yet, so
> `EyesOnAgentsClaudeDirectoryStatus` is a single synthetic entry (`id`/`label` empty) carrying
> `state: "error"` (malformed value — recoverable only via **Change directory**/**Use automatic**,
> matching the pre-084 recovery contract) or `state: "retrying"` (a thrown read error — bounded
> auto-retry) — exactly generalizing the pre-085 singleton's one fixed error/retrying status object.
> Once hydration succeeds, the array switches to one entry per real environment.

> **Implementation note (task 085):** each environment's `ClaudeWatcherSupervisor` needs its own
> inventory-bridge Unix socket/named pipe, not just its own child process — `getClaudeInventoryBridgeEndpoint`
> (`claudeInventoryBridge.contract.ts`) gained an optional third `environmentId` parameter that
> scopes the socket/pipe path per environment; omitting it (every pre-085 caller, including tests)
> reproduces the exact previous single path. Without this, two simultaneously-running environments
> would collide on the same endpoint.

> **Implementation note (task 085):** the reconciliation path from a CRUD mutation
> (`ClaudeDirectoryConfigService.addEnvironment`/`removeEnvironment`/`setEnvironmentEnabled`/
> `renameEnvironment`/`chooseCustomDirectory`/`useAutomatic`) to this watcher map is
> `ClaudeObservationService.applyEnvironments()` — a new public method (no arguments; it re-reads
> `directoryConfig.listEnvironments()` itself) that diffs the map against the authoritative list and
> starts/stops/restarts only the environments that actually changed. `eyes-on-agents.handler.ts`'s
> six environment-CRUD XPC methods each call it once after persisting their mutation, which is what
> makes "enabling/adding starts a supervisor; disabling/removing stops one" true end-to-end today,
> not only as an internal capability of the service.

> **Implementation note (task 085):** `clearClaudeTranscriptCapabilities()` and the Claude Agent
> View poll/reconcile pair (`ClaudeAgentsAdapter.poll` / `reconcileClaudeAgentStates`) remain
> **global, all-Claude-provider** repository operations — the schema has no per-root or
> per-environment scoping column for either (Hook attribution's `claude_config_dir`, task 087, is a
> raw path on thread rows, not a scope for these calls). Each environment still triggers its own
> capability-clear/agent-poll independently on its own (re)start, exactly mirroring the pre-085
> single-instance mechanism; this task does not add per-environment scoping to either repository
> call. Practical effect: (re)starting or reconfiguring one environment while sibling environments
> are already `watching` can transiently clear their already-scanned transcript capabilities until
> their own next scan repopulates them, and each environment's own refresh cycle polls Claude Agent
> View independently rather than once per service tick. This mirrors this feature's own "Scope
> decisions" section (the plugin bridge's shared, non-isolated installation identity) — full
> per-environment isolation of these two repository calls is a real possible future increment, not
> this one.

**Logging.** The watcher lifecycle log lines (start, ready handshake, retry, fatal watcher-error
generation teardown) carry an environment `id`/`label` field so a packaged-app log can show which
environment a given retry/error belongs to; no new log file, same `main.log` and scope convention
as today (`[claude-watcher]`, alongside the existing `[claude-environment]` config-mutation scope).

> **Implementation note (task 085):** inspection of the pre-085
> `claudeObservation.service.ts`/`claudeWatcher.supervisor.ts` found no existing watcher lifecycle
> log lines at all (no `console.*`/`electron-log` calls of any kind in either file) — the sentence
> above originally assumed lines to "extend." This task adds them fresh: `start`/`retry`/`fatal` are
> logged from `claudeObservation.service.ts`, `ready` from `claudeWatcher.supervisor.ts` (the only
> place that observes the raw IPC handshake). `configDirectory` is never included in any of them.

## Plugin / Hook installation per environment

`claudeCommand.runner.ts`'s `spawn(executable, args, {...})` call currently passes no `env` option
at all, so it inherits Bitterless's own ambient environment verbatim — every `claude` CLI invocation
today implicitly targets whatever `CLAUDE_CONFIG_DIR` (almost always unset) exists in that process.
This gains one additional optional parameter threaded from `claudePluginBridge.service.ts`'s call
sites:

```ts
runClaudeCommand(args, { configDirectory }?: { configDirectory?: string | null })
// spawn(executable, args, { ..., env: configDirectory
//   ? { ...process.env, CLAUDE_CONFIG_DIR: configDirectory }
//   : process.env })
```

Install/enable/remove/status become environment-scoped by adding `{ environmentId }` to each
existing XPC method's parameters — `installClaudeBridge({ environmentId })`,
`getClaudeBridgeStatus({ environmentId })`, `refreshClaudeBridgeStatus({ environmentId })`,
`removeClaudeBridge({ environmentId })`. Each resolves that environment's `configDirectory` (or
`undefined` for the one automatic environment, preserving today's exact ambient-environment
behavior) and runs the **existing, unmodified** install/enable/remove sequence against it. As
established in "Scope decisions" above, every environment's plugin installation shares the same
`installationId`/socket/outbox — this task changes only which `CLAUDE_CONFIG_DIR` the CLI targets,
not the installation-identity state machine itself.

**Logging.** The existing plugin-bridge lifecycle/error logging (mutation stage + sanitized error
name, no raw CLI output or executable path, per
[EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md)'s privacy rules) gains the
target environment's `id`/`label`; `configDirectory` values are never logged, matching the data-model
section's rule.

## Hook payload attribution (schema V4)

The Hook payload carries no field today identifying which `CLAUDE_CONFIG_DIR` emitted a delivery —
confirmed by inspection, not assumed. `src/shared/eyesOnAgents/claudeHookBridge.type.ts` gains a
fourth schema version, following the exact event-conditional-optional-field precedent V3 used for
`terminalApp`/`terminalSessionId`:

```ts
type ClaudeHookEnvironmentFieldAbsent = { claudeConfigDir?: never };

type ClaudeHookEventV4Payload =
  | (Omit<ClaudeHookEventV3Payload, 'hookEventName'> & {
      hookEventName: Exclude<ClaudeHookEventName, 'SessionStart'>;
    } & ClaudeHookEnvironmentFieldAbsent)
  | (Omit<ClaudeHookEventV3Payload, 'hookEventName'> & {
      hookEventName: 'SessionStart';
    } & (
      | ClaudeHookEnvironmentFieldAbsent
      | { claudeConfigDir: string }
    ));

interface ClaudeHookEventV4 {
  schemaVersion: 4;
  eventId: string;
  occurredAt: number;
  payload: ClaudeHookEventV4Payload;
}

type ClaudeHookEvent = ClaudeHookEventV1 | ClaudeHookEventV2 | ClaudeHookEventV3 | ClaudeHookEventV4;
```

- `claudeConfigDir` is `process.env.CLAUDE_CONFIG_DIR` read verbatim at `SessionStart` when it is a
  non-empty absolute path; absent/empty produces the field-absent shape (this is the "ambient
  default" case — Main cannot distinguish "unset, meaning the automatic environment" from "unset,
  meaning some other tool" any more precisely than that, and does not need to: absence means
  "attribute to the automatic environment," which is the correct default).
- Following the same delegation rule task 081 established for V3: only a genuine `SessionStart`
  event bumps `schemaVersion` to `4`; every other `hookEventName` delegates straight through the
  unchanged V3 constructor and keeps emitting `schemaVersion: 3` (which itself still delegates
  non-`SessionStart` events to the unchanged V2 constructor). Terminal identity and environment
  identity are both `SessionStart`-only facts, so this chain of delegation is additive at every
  level and never revisits an already-shipped constructor's behavior.
- `eyes_on_agents_thread` gains one more nullable column, `claude_config_dir TEXT`, populated the
  same way `iterm2_session_id` is (independent COALESCE-preserve upsert; no collision/ambiguity
  check). This is a raw path string, not a foreign key to `EyesOnAgentsClaudeEnvironment.id` —
  environments can be renamed or removed independently of already-persisted thread rows, so
  attribution is resolved at snapshot-read time by matching a thread's `claude_config_dir` against
  the currently configured environments' `configDirectory` values (path-normalized comparison), not
  stored as a stale foreign key. A thread whose stored path matches no currently configured
  environment (the environment was since removed) simply has no resolved label — it remains a
  normal Main-private-or-visible row exactly as it does today, just without an environment badge.

**Logging.** Hook delivery commit logging gains only whether attribution matched a known
environment (boolean) plus that environment's `id`/`label` when matched — the raw
`claude_config_dir` value is never logged, matching every other content-free rule in this Hook
pipeline.

## Renderer

`ClaudeObservationCard.vue`'s single directory block becomes an environment list, structurally
mirroring the already-shipped `claudeSubscription` accounts list pattern in this codebase (a proven
precedent for "user-managed list of named, independently enabled/status-tracked entities" — add,
rename, remove, enable/disable):

- One row per `EyesOnAgentsClaudeEnvironment`: label, resolved path (or "not configured"), mode,
  the existing per-environment watcher status pill (`watching`/`waiting`/`degraded`/`retrying`/
  `error`/`stopped`), and the existing per-environment plugin/hook setup action
  (`enable`/`finish`/`reload`/`retry`/`repair`) — the setup-action state machine itself is unchanged,
  it is simply evaluated once per environment instead of once globally.
- Row actions: rename, change directory (opens the existing native picker) or "Use automatic" for
  the one eligible environment, enable/disable, remove (disabled for the last remaining
  environment).
- A persistent "Add environment" action opens a small form (label + directory picker), always
  creating a `mode: 'custom'` entry.
- One short guidance note (replacing the standalone note originally proposed for this section):
  "Each environment needs its own hook install. Point Bitterless at your environment's
  `CLAUDE_CONFIG_DIR`, then Install — and make sure the shell command you use for that environment
  (e.g. a `claude2` wrapper) sets `CLAUDE_CONFIG_DIR` before invoking `claude`." This follows the
  `eyes-connection-panel__boundary` aside pattern already used for the App Server "Desktop note."
- `ThreadCard.vue`'s existing folder tooltip gains the resolved environment label when a thread's
  `claude_config_dir` matches a currently configured environment (e.g. "claude2 · /path/to/project"
  instead of just the path) — a small, additive change to existing tooltip text, not a new UI
  element, so a single-environment user sees no visible change (there is nothing to disambiguate).

## Non-goals

- Per-environment plugin installation identity/coverage isolation (distinct `installationId`,
  socket, or outbox per environment). Every environment within one Bitterless profile shares the
  existing single installation-identity state machine; see "Scope decisions."
- WezTerm/Ghostty terminal support (unchanged from
  [EyesOnAgents iTerm2 Open](eyes-on-agents-iterm2-open.md)).
- Automatically discovering `CLAUDE_CONFIG_DIR` values the user has not explicitly added (e.g.
  scanning `~` for `.claude*`-looking directories). Every environment beyond the default is
  explicitly added by the user through the native picker.
- Migrating or deduplicating two configured environments that happen to resolve to the same
  directory. The CRUD surface does not prevent this; it is treated as a user configuration error,
  not a state Bitterless corrects for.
- Any change to the Claude subscription accounts feature (API-credential routing) — a completely
  separate subsystem this feature only borrows a UI/data-model shape from.

## Acceptance

- A fresh install and an existing installation with a persisted `schemaVersion: 1` directory config
  both hydrate to exactly one `automatic`, enabled, default environment — no user-visible change
  until "Add environment" is used.
- Adding a second environment with a valid directory starts its own independent watcher; that
  watcher's retry/error state never appears on, or is affected by, the default environment's status,
  and vice versa.
- Installing the hook for a second environment runs the `claude` CLI with
  `CLAUDE_CONFIG_DIR` set to that environment's directory and does not alter the default
  environment's plugin installation, enabled state, or installation identity.
- A Claude Code session started with that second environment's `CLAUDE_CONFIG_DIR` is discovered
  (via its own watcher) and/or Hook-observed (via the shared installation, since the same
  `installationId`/socket serves every environment) exactly as the default environment's sessions
  are today, including the already-shipped iTerm2 Open path.
- That session's thread row records `claude_config_dir` matching the second environment's directory;
  the renderer resolves and displays that environment's label without persisting a foreign key to it.
- Removing an environment stops only its watcher and removes it from the configured list; it does
  not retroactively clear `claude_config_dir` on already-persisted thread rows, and a thread whose
  environment was removed simply loses its resolved label.
- The last remaining environment cannot be removed.
- No `configDirectory` value is ever written to `main.log`; environment lifecycle, watcher, plugin,
  and Hook-attribution log lines identify an environment only by `id`/`label`.
- Repository, migration audit, core, bridge, UI-source, typecheck, and production build checks run
  without launching Electron windows.
- Manual, non-automatable verification: with two real `CLAUDE_CONFIG_DIR` directories and two wrapped
  `claude`/`claude2` shell commands, confirm both environments' sessions appear in Focus
  simultaneously with correct, independent status in the Connections drawer. Owner-only.

## Sources

- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) — hook definitions are registered per
  `CLAUDE_CONFIG_DIR` in that directory's own `settings.json`.
- [Claude Code CLI configuration](https://code.claude.com/docs/en/settings) — `CLAUDE_CONFIG_DIR`
  environment variable contract.
