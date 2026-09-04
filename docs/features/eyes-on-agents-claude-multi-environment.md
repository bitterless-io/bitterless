# EyesOnAgents Claude Multi-Environment

Status: Implemented; owner runtime verification pending (real two-environment check, see Acceptance)

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
runClaudeCommand(executable, args, {
  timeoutMs, maxOutputBytes, configDirectory
}?: { timeoutMs?: number; maxOutputBytes?: number; configDirectory?: string | null })
// spawn(executable, args, { ..., env: configDirectory
//   ? { ...process.env, CLAUDE_CONFIG_DIR: configDirectory }
//   : process.env })
```

> **Implementation note (task 086):** `configDirectory` is one more optional field on the existing
> third `options` object (alongside `timeoutMs`/`maxOutputBytes`), not a second parameter — the
> earlier sketch above omitted the required `executable` argument and the existing options shape.
> `ClaudePluginBridgeService`'s private `command(executable, args, configDirectory?)` wrapper is the
> single call site that forwards it into `runClaudeCommand`'s options; every internal method that
> transitively calls `command()` (`inspectCurrent`, `refreshWithoutAutomaticUpgrade`,
> `performTrustedAutomaticUpgrade`, `performInstall`, `remove`,
> `recoverLegacyProductionDebugMarketplace`, `inspectClaudeNamespace`) gained a matching optional
> `configDirectory` parameter threaded through unchanged, without touching any installation-identity
> branching. One deliberate exception: `resolveExecutable()`'s two capability-probe commands
> (`plugin --help`, `plugin marketplace remove --help`, used to pick which allowlisted `claude`
> binary supports scoped marketplace removal) are **not** environment-scoped and always run against
> the ambient environment — the answer to "does this binary support `--scope`" does not depend on
> which `CLAUDE_CONFIG_DIR` is active, and the resolved executable is cached once per
> `ClaudePluginBridgeService` instance (shared across every environment) regardless.

Install/enable/remove/status become environment-scoped by adding `{ environmentId }` to each
existing XPC method's parameters — `installClaudeBridge({ environmentId })`,
`getClaudeBridgeStatus({ environmentId })`, `refreshClaudeBridgeStatus({ environmentId })`,
`removeClaudeBridge({ environmentId })`. Each resolves that environment's `configDirectory` (or
`undefined` for the one automatic environment, preserving today's exact ambient-environment
behavior) and runs the **existing, unmodified** install/enable/remove sequence against it. As
established in "Scope decisions" above, every environment's plugin installation shares the same
`installationId`/socket/outbox — this task changes only which `CLAUDE_CONFIG_DIR` the CLI targets,
not the installation-identity state machine itself.

> **Implementation note (task 086):** `{ environmentId }` is **optional**, not required as the
> sketch above literally reads — an omitted value resolves to `environments[0]` (the one automatic
> environment), reproducing today's exact zero-argument behavior byte-for-byte. This is a deliberate
> deviation from the task's literal phrasing, made because `ClaudeObservationCard.vue` and
> `eyesOnAgents.store.ts` already call all four methods with zero arguments today, and the renderer
> is explicitly out of this task's scope; extending those call sites to pass a real
> `{ environmentId }` (e.g. from an environment picker) is left for whichever task first builds that
> renderer surface — most likely task 088, mirroring task 084's identical scope decision for its own
> new CRUD methods. Consequently the shared `EyesOnAgentsApi` type (`eyesOnAgents.type.ts`) keeps
> these four methods' pre-086 zero-argument signatures unchanged: both `EyesOnAgentsHandler` and
> `EyesOnAgentsService` also declare `implements EyesOnAgentsApi`, and a class method with an added
> *optional* parameter still satisfies a narrower interface member (it remains callable with zero
> arguments), so no ripple into that interface or into `EyesOnAgentsService`'s public type is
> required. An explicitly supplied, unknown `environmentId` still rejects cleanly before any CLI
> command is attempted — resolution happens via a new pure, unit-tested
> `resolveClaudeBridgeEnvironment` helper (`claudeBridgeEnvironment.resolver.ts`) called from
> `eyesOnAgents.handler.ts` before any bridge/service call.
>
> **The actual install/enable/remove/status orchestration lives in `eyesOnAgents.service.ts`, not
> only in `claudePluginBridge.service.ts`.** `EyesOnAgentsHandler`'s four methods delegate to
> `EyesOnAgentsService.installClaudeBridge`/`refreshClaudeBridgeStatus`/`removeClaudeBridge`/
> `getClaudeBridgeStatus`, which own the Claude-provider-management guards, the shared Hook listener
> stop/start dance, and active-state invalidation around the actual `claudeBridge.install()`/
> `.refresh()`/`.remove()` calls — this file was not in task 086's Path list, but three of those four
> methods needed a minimal, additive `configDirectory?: string` parameter threaded to
> `this.dependencies.claudeBridge` (whose `install`/`refresh`/`remove` members gained the same
> parameter) for the resolved directory to ever reach the CLI layer end to end. `getClaudeBridgeStatus`
> needed no such change — it is a pure status read (`claudeBridge.getStatus()`, no CLI call), so
> `{ environmentId }` there only validates that the environment exists before returning the one
> shared status, matching the non-goal that every environment shares one installation identity.

**Logging.** The existing plugin-bridge lifecycle/error logging (mutation stage + sanitized error
name, no raw CLI output or executable path, per
[EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md)'s privacy rules) gains the
target environment's `id`/`label`; `configDirectory` values are never logged, matching the data-model
section's rule.

> **Implementation note (task 086):** inspection of the pre-086 `claudePluginBridge.service.ts` and
> `eyesOnAgents.service.ts` found no existing `[claude-bridge]`-style plugin-bridge-specific log
> lines at all (`electron-xpc`'s generic `[XpcMainHandler] error in <channel>` catch-all is the only
> thing that logged a thrown bridge error, with no stage/id/label structure) — the phrasing above
> assumed lines to "extend" that did not exist, exactly mirroring task 085's identical finding for
> the pre-085 watcher. New `[claude-bridge] action=<install|refresh|remove|status> id=<id>
> label="<label>"[ error=<sanitized, 300-char-bounded>]` lines are added fresh from
> `eyesOnAgents.handler.ts`, via a small new `logClaudeBridgeAction` helper
> (`claudeBridgeLog.helper.ts`) — success is logged for install/refresh/remove (mutations), while a
> pure status read logs only on error. Both helpers avoid touching the invariant-dense
> `claudePluginBridge.service.ts` state machine, keeping that file's task-086 diff to pure
> `configDirectory` call-site threading as instructed.

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

> **Implementation note (task 087):** the task's own Path list did not name
> `src/main/eyesOnAgents/claudeHookBridge.helper.ts`, but the helper subprocess's one call site is
> the only place that actually invokes a version constructor at runtime — task 081 swapped this same
> call site from `createClaudeHookEventV2` to `createClaudeHookEventV3` for the identical reason.
> Leaving it on `createClaudeHookEventV3` would mean `CLAUDE_CONFIG_DIR` is never captured outside
> tests, defeating this task's objective, so it now calls `createClaudeHookEventV4`. This has one
> necessary, mechanical consequence: `eyesOnAgents.service.ts`'s pre-existing `iterm2SessionId`
> derivation in `commitClaudeHookDeliveryInternal` (task 082) narrowed on `delivery.event.schemaVersion
> === 3` to read `payload.terminalApp`; since a genuine `SessionStart` now legitimately arrives as
> `schemaVersion: 4` (still carrying `terminalApp`/`terminalSessionId` unchanged), that check widened
> to `schemaVersion === 3 || schemaVersion === 4` so already-shipped iTerm2 attribution keeps working
> once V4 is live. No other part of the V3 terminal-identity capture or consumption logic changed.
> The one pre-existing test asserting the real helper subprocess's `schemaVersion` for a genuine
> `SessionStart` (`scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs`) was updated from
> `3` to `4` for the same reason, mirroring task 082's precedent of updating exactly one pre-existing
> test fixture when a new schema version legitimately changes real subprocess output.

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

> **Implementation note (task 087):** matching a captured `claude_config_dir` against a known
> environment's `id`/`label` requires the configured-environments list, which is a service/renderer
> concern this task does not touch (see the Objective's "does NOT resolve or store an environment
> label/id on the thread row" boundary). Task 087's log line therefore carries only whether a value
> was captured on `SessionStart` (`environmentAttribution=true/false`) — never a matched `id`/`label`
> and never the raw path. Logging the matched environment's `id`/`label` is task 088's job, once
> snapshot-read-time matching exists.

## Renderer

> **Implementation note (task 093):** the environment list no longer lives in
> `ClaudeObservationCard.vue`. Owner feedback after configuring a real `claude2` environment was
> that the UI never says the one thing that decides whether a CLI session appears — that it has to
> be started inside iTerm2 — while the list sat next to Claude Desktop concerns it has nothing to do
> with. The list moved whole into a new `ClaudeIterm2Card.vue`, rendered in a third Connections rail
> section, **Claude in iTerm2**; the rail is now driven by a `ConnectionSection` union
> (`'codex' | 'claude' | 'claude-iterm2'`) rather than the provider union, which survives only for
> the logo. Every row control (add/rename/remove/enable, the inline path editor, per-row plugin
> presence and its Install/Check action, per-row Retry, Copy setup command, Use automatic, the
> guidance note) relocated unchanged. Two things did change: the new section states the iTerm2
> requirement and the `/reload-plugins` caveat, and `Desktop metadata directories: N` left the rows
> for the Claude section, shown **once** — it is the same platform-fixed number on every row
> (`resolveClaudeDesktopRoots` derives from platform/home/env and never reads a `configDirectory`),
> read from the environments array rather than from a new Main-side field, and rendered not at all
> when no environment reports a usable value. Gating is unchanged: the single `Claude support`
> switch stays in the Claude section and folds both cards.

`ClaudeObservationCard.vue`'s single directory block becomes an environment list, structurally
mirroring the already-shipped `claudeSubscription` accounts list pattern in this codebase (a proven
precedent for "user-managed list of named, independently enabled/status-tracked entities" — add,
rename, remove, enable/disable):

- One row per `EyesOnAgentsClaudeEnvironment`: label, resolved path (or "not configured"), mode,
  the existing per-environment watcher status pill (`watching`/`waiting`/`degraded`/`retrying`/
  `error`/`stopped`), that environment's desktop-directory count and last-successful-scan time (plus
  a next-retry note once one is scheduled), a manual per-environment **Retry** button in the same
  states the pre-multi-environment single block offered it (a global Claude provider error, or the
  row's own state being `waiting`/`degraded`/`retrying`/`error`), and the existing per-environment
  plugin/hook setup action (`enable`/`finish`/`reload`/`retry`/`repair`) — the setup-action state
  machine itself is unchanged, it is simply evaluated once per environment instead of once globally.

> **Implementation note (task 088, gap-1 completion):** the initial task 088 delivery replaced the
> single directory block with the environment list above but dropped the desktop-directory-count/
> last-successful-scan/next-retry metadata and the manual Retry button entirely (flagged as a real,
> letter-vs-Objective gap in that task's own Implementation evidence). A follow-up completion pass
> restored all of it per row: `retryClaudeDirectory` widened to `(params?: { environmentId?: string
> }) => Promise<EyesOnAgentsSnapshot>` (mirroring the 4 bridge methods' shape exactly), resolving to
> that environment's id and retrying only its watcher via the pre-existing
> `ClaudeObservationService.retryEnvironmentEntry`; an omitted `environmentId` still retries
> `environments[0]`, reproducing every pre-088 zero-arg caller unchanged. The renderer gained a
> `retryClaudeDirectoryForEnvironment(id)` store method (per-id busy gate, like
> `chooseClaudeEnvironmentDirectory`/`useAutomaticClaudeEnvironment` — retrying one environment's
> watcher is fully independent of every other environment's, unlike the shared-identity bridge
> install/refresh actions) and a `handleRetryEnvironment` row handler that falls back to the legacy
> zero-arg `retryClaudeDirectory()` for the synthetic empty-id sentinel row, exactly like Change
> directory/Use automatic.

> **Implementation note (task 088):** per the "Scope decisions"/Non-goals installation-identity
> boundary above, the setup-action status/label shown in each row is **not** independently evaluated
> per environment — it stays the single existing `bridge.value?.setupAction` computed, so every row
> currently displays identical setup-action text/state. What is per-environment is only the
> **Install**/**Retry listener** button's click target: clicking it in a given row calls
> `installClaudeBridge`/`refreshClaudeBridgeStatus` with that row's `{ environmentId }`, so the
> underlying `claude` CLI invocation targets that environment's `CLAUDE_CONFIG_DIR` even though the
> displayed status is shared. This corrects this bullet's "evaluated once per environment" phrasing,
> which read as implying independent per-row status.

- Row actions: rename, change directory (opens the existing native picker) or "Use automatic" for
  the one eligible environment, enable/disable, remove (disabled for the last remaining
  environment).
- A persistent "Add environment" action opens a one-field form: the **absolute
  `CLAUDE_CONFIG_DIR`, pasted** (task 091). It always creates a `mode: 'custom'` entry, and the
  label is **derived from the directory** (`/Users/ral/.claude2` → `claude2`) rather than asked for.
  This replaced an earlier label-plus-native-picker form: a Claude config directory is a hidden
  dotfile directory, which the macOS dialog makes awkward to reach, while the absolute path is a
  single paste. Rename remains available for anything the derivation gets wrong.
- **Change directory** (task 092) repoints an existing environment the same way: it turns that
  row's path field into an inline editor prefilled with the current directory, with Save/Cancel
  mirroring Rename. The native picker survives in exactly one place — the synthetic
  invalid-hydration row, which has no environment id to address and whose picker is the recovery
  affordance of last resort. Repointing never re-derives the label, so a renamed environment keeps
  its name.
  - **Trust boundary note.** Adding and repointing are the two places the renderer supplies a
    filesystem path. Main still validates every one through `requireCanonicalClaudeConfigDirectory`
    — absolute, existing, non-symlink, not a filesystem root — before it is persisted, watched, or
    used as `CLAUDE_CONFIG_DIR`: the renderer proposes, Main disposes.
    `scripts/eyes-on-agents/ui-source.test.mjs` pins this with a **negative** assertion over the
    whole renderer tree (only the Claude connection card and the store may mention
    `configDirectory` at all), because a positive match on the allowed methods cannot prove
    exclusivity — review 1 of task 091 caught exactly that weakness in an earlier form of the check.
    What validation does **not** constrain is *which* real directory: `/etc`, another user's home,
    or any other readable directory passes. The residual capability is bounded by what Bitterless
    then does with it — read `<dir>/projects/**` for transcripts, and pass it as `CLAUDE_CONFIG_DIR`
    to a fixed-argv `claude` invocation with no shell. There is no delete path. Note that a
    subsequent Install action does let the real `claude` CLI write plugin config into that
    directory.
- One short guidance note (replacing the standalone note originally proposed for this section):
  "Each environment needs its own hook install. Point Bitterless at your environment's
  `CLAUDE_CONFIG_DIR`, then Install — and make sure the shell command you use for that environment
  (e.g. a `claude2` wrapper) sets `CLAUDE_CONFIG_DIR` before invoking `claude`." This follows the
  `eyes-connection-panel__boundary` aside pattern already used for the App Server "Desktop note."
- `ThreadCard.vue`'s existing folder tooltip gains the resolved environment label when a thread's
  `claude_config_dir` matches a currently configured environment (e.g. "claude2 · /path/to/project"
  instead of just the path) — a small, additive change to existing tooltip text, not a new UI
  element, so a single-environment user sees no visible change (there is nothing to disambiguate).

## Per-environment setup: copyable shell command and install probe

Tasks 084-088 shipped the environment list, but walking the real end-to-end setup surfaced two gaps
that leave the flow unfinishable from inside Bitterless. Both are addressed here (tasks 089, 090).

### The gap

The guidance note tells the user their `claude2` wrapper must set `CLAUDE_CONFIG_DIR` before
invoking `claude`, but that is the one step Bitterless cannot perform and gives no help with — the
user has to hand-write the shell plumbing from a sentence of prose. And after clicking Install on an
environment's row, nothing in the UI confirms it worked *for that environment*: the setup action's
status is global (one `installationId`, one `this.inspection` slot on the plugin bridge), so every
row shows the same title and the same button whether or not that particular
`CLAUDE_CONFIG_DIR` actually received the plugin. The user's only recourse today is to read
`~/.claude2/settings.json` by hand or start a session and see whether a row appears.

### Copyable shell command (task 089)

Each `mode: 'custom'` row with a configured directory gains a **Copy setup command** action that
puts a ready-to-paste shell wrapper on the clipboard, derived from that row's label and directory:

```sh
# Bitterless: Claude environment "claude2"
claude2() { CLAUDE_CONFIG_DIR='/Users/ral/.claude2' command claude "$@"; }
```

- The function name comes from the environment's label, lowercased with every character outside
  `[a-z0-9_]` collapsed to `_`, prefixed with `_` if it would otherwise start with a digit, and
  falling back to `claude_env` when nothing usable remains. A label of `claude` is therefore allowed
  and safe: `command claude` skips function lookup **for the name it is given**, so a wrapper named
  `claude` runs the `claude` executable instead of recursing into itself.
- **A label deriving to `command`, or to a shell reserved word, also falls back to `claude_env`.**
  `command` is a *regular* builtin, so a wrapper named `command` shadows the very mechanism the body
  relies on and recurses — bash hangs outright, zsh aborts with "maximum nested function level
  reached" — which is the one case the `claude` guarantee above does **not** cover. Guarded
  alongside it is the union of bash's and zsh's reserved-word tables restricted to `[a-z0-9_]`
  (`case`, `coproc`, `do`, `done`, `elif`, `else`, `end`, `esac`, `fi`, `for`, `foreach`,
  `function`, `if`, `in`, `nocorrect`, `repeat`, `select`, `then`, `time`, `until`, `while`): each
  either cannot be parsed as a function definition or is parsed as a reserved word at the call site,
  so the pasted snippet would be a syntax error or an unreachable wrapper rather than a definition.
  Reserved words made only of punctuation (`!`, `{`, `}`, `[[`, `]]`) collapse to `_` under the
  `[a-z0-9_]` sanitization and are unreachable, so they are deliberately not listed.
- The directory is emitted **single-quoted** and verbatim from `configuredDirectory` (already
  realpath-canonicalized by `requireCanonicalClaudeConfigDirectory`), so the snippet's path matches
  what the label resolver compares against. Single quotes rather than double: bash and zsh both make
  history expansion (`!`), parameter expansion, command substitution and backslash escapes inert
  inside `'…'`, which leaves `'` as the only character to escape (as the standard `'\''`) — whereas a
  double-quoted path containing `!` cannot be pasted at an interactive prompt in **either** shell
  (`event not found`).
- The automatic environment gets no such action — it needs no wrapper, and its `configuredDirectory`
  is `null` by definition.
- **The snippet contains a real filesystem path, so it must never be logged.** This is the same
  constraint the existing "no `configDirectory` in `main.log`" rule imposes; a user-initiated
  clipboard write is the one sanctioned egress, and it reuses the existing
  `writeClipboardText` dependency already used by **Copy `/reload-plugins`**.

### Per-environment install probe (task 090)

A narrow, read-only probe answers exactly one question per environment — *is the Bitterless plugin
present and enabled in this `CLAUDE_CONFIG_DIR`?* — and nothing else.

- It reuses `ClaudePluginBridgeService.inspectClaudeNamespace(executable, configDirectory)`
  (`claudePluginBridge.service.ts:1354`), which is **already** per-directory and already pure: it
  returns a value and does not touch `this.inspection`. The probe is a thin wrapper over it.
- **It deliberately does not make `this.inspection` per-environment.** That field has ~50 usages
  across a 1,564-line file that is already over the review size limit and holds this codebase's
  densest installationId lifecycle state machine; converting it to a map would be a large, risky
  refactor for a read-only status readout. The shared installation identity stays exactly as it is.
- The probe spawns two `claude` CLI calls per environment, so it must never run inside
  `getSnapshot()`. It is cached per environment id with its own timestamp and refreshed only on:
  app start, that environment being added or having its directory changed, and an explicit
  install/refresh/retry action on that row.
- It surfaces as `pluginPresence: 'installed' | 'disabled' | 'not_installed' | 'unknown'` plus
  `pluginProbedAt` on `EyesOnAgentsClaudeEnvironmentStatus`. `'unknown'` covers never-probed, probe
  failure, and a missing/unusable `claude` executable — it never guesses `'not_installed'` from an
  error, because "we could not check" and "we checked and it is absent" drive different user action.
- The per-row surface splits along the real boundary: **plugin presence is per environment**
  (from this probe), **listener/runtime state stays global** (one socket, one outbox). The row shows
  its own presence pill; the global listener status is not duplicated per row.

## Non-goals

- Per-environment plugin installation identity/coverage isolation (distinct `installationId`,
  socket, or outbox per environment). Every environment within one Bitterless profile shares the
  existing single installation-identity state machine; see "Scope decisions." Task 090's
  per-environment install probe is **read-only** and explicitly does not breach this: it reports
  whether a directory has the plugin, and never gives an environment its own identity, socket,
  outbox, or `this.inspection` slot.
- Per-environment listener/runtime status. The listener, socket, and outbox are one per profile, so
  "is the listener running" stays a single global fact and is not duplicated onto environment rows.
- Writing the task 089 shell snippet into the user's shell profile (`.zshrc`, `.bashrc`, a wrapper
  script) on their behalf. Bitterless puts it on the clipboard; installing it is the user's step.
- Verifying that the user's wrapper actually exports `CLAUDE_CONFIG_DIR` correctly. Task 090's probe
  inspects the *directory*, not the user's shell configuration; a wrapper that silently fails to set
  the variable shows up as sessions landing on the wrong environment, not as a probe failure.
- WezTerm/Ghostty terminal support (unchanged from
  [EyesOnAgents iTerm2 Open](eyes-on-agents-iterm2-open.md)). Task 093's **Claude in iTerm2** section
  explains the current limitation to the user; widening it remains this same non-goal.
- De-duplicating the Desktop metadata watcher. N environments each spawn a watcher over the *same*
  platform-fixed Claude Desktop metadata root, which is why task 093 shows the directory count once
  instead of per row. Collapsing that to one shared Desktop watcher is a real improvement but a
  watcher change, recorded in `docs/plan/backlog.md`.
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
- A `mode: 'custom'` environment labelled `claude2` pointing at `/Users/ral/.claude2` yields a
  clipboard snippet defining a `claude2()` shell function that sets that exact `CLAUDE_CONFIG_DIR`
  and invokes `command claude`; the automatic environment offers no such action; and the snippet's
  path never appears in `main.log`.
- After Install succeeds on one environment's row, that row (and only that row) reports
  `pluginPresence: 'installed'`; an environment whose directory has never been installed into
  reports `'not_installed'`; a probe that could not run reports `'unknown'` rather than
  `'not_installed'`.
- The probe never runs inside `getSnapshot()` — no `claude` CLI process is spawned by rendering or
  refreshing the board.
- Repository, migration audit, core, bridge, UI-source, typecheck, and production build checks run
  without launching Electron windows.
- Manual, non-automatable verification: with two real `CLAUDE_CONFIG_DIR` directories and two wrapped
  `claude`/`claude2` shell commands, confirm both environments' sessions appear in Focus
  simultaneously with correct, independent status in the Connections drawer. Owner-only — the
  concrete steps are below.

## Owner verification on a preview build

The owner tests on the packaged **preview** build (`yarn build_preview:mac_arm`, which runs under
runtime profile `release_preview` → profile id `production-preview`). Two consequences shape the
whole procedure and are easy to be surprised by:

1. **The preview build has its own Claude plugin identity.**
   `resolveClaudePluginBridgeIdentity('production-preview')` yields marketplace
   `bitterless-local-production-preview`, plugin
   `bitterless-observer-production-preview@bitterless-local-production-preview`, and artifacts under
   `eyes-on-agents/claude-marketplace-production-preview`. It is therefore a **separate installation
   from the production Bitterless**, and the two coexist inside the same `CLAUDE_CONFIG_DIR`.
   Installing from the preview build does not touch production's plugin, and does not require
   uninstalling it first.
2. **Because the identity differs, the per-environment probe reports on the preview plugin only.** A
   directory that already has the *production* plugin installed still shows **Plugin not installed**
   in the preview build until the preview plugin is installed there. That is correct, not a bug.

Assuming a `claude2` wrapper already exists (the owner's is `/usr/local/bin/claude2`, a PATH script
— see "Shell wrapper shapes" below), the procedure is:

| # | Step | Expected |
|---|---|---|
| 1 | Build and launch the preview app | it runs alongside production Bitterless |
| 2 | EyesOnAgents → **Agent Connections** → Claude card, provider toggle on | the environment list shows one row, the automatic default |
| 3 | **Add environment**, label `claude2`, pick `~/.claude2` in the native picker | a second row appears, `Custom`, path shown; cancelling the picker adds nothing |
| 4 | Read both rows' presence pills | both likely **Plugin not installed** — the preview plugin is not in either directory yet |
| 5 | Click **Install plugin** on the `claude2` row only | that row flips to **Plugin installed**; the default row stays **not installed** — this is the whole point of task 090 |
| 6 | Confirm isolation on disk | `~/.claude2/settings.json` gains the preview hook; `~/.claude/settings.json` is untouched |
| 7 | Run `claude2` in an **iTerm2** pane and send one prompt | a row appears in Focus tagged with the `claude2` environment label |
| 8 | Use that row's **Open in iTerm2** | focus jumps back to that exact pane |
| 9 | Run plain `claude` in another iTerm2 pane | a second row appears, attributed to the default environment, both live at once |
| 10 | Rename the `claude2` environment | the label updates on the row and on its threads; no re-probe, no CLI spawn |
| 11 | Try **Remove** on the last remaining environment | disabled, with the explanatory hint |

**Copy setup command** is *not* on this path when a wrapper already exists — step 3 replaces it. Use
it only to check the snippet it produces (see the shell caveat below).

### Shell wrapper shapes

Task 089's **Copy setup command** emits a shell **function** for a shell profile
(`.zshrc`/`.bashrc`). That is not the only shape, and not the one the owner actually uses:

| shape | works in | survives non-interactive spawn | notes |
|---|---|---|---|
| function in a shell profile (what 089 emits) | bash, zsh, sh | no | **syntax error in fish/nushell** |
| script on `PATH` (owner's `/usr/local/bin/claude2`) | any shell | yes | shell-agnostic; also reachable by other programs |

The owner's script additionally `unset`s `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and
`CLAUDE_CODE_OAUTH_TOKEN` so the second environment uses its own Claude login instead of inheriting
shell-level credentials — which is the actual reason for wanting multiple environments. The emitted
snippet does **not** do this. Both gaps are recorded in `docs/plan/backlog.md`.

## Sources

- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) — hook definitions are registered per
  `CLAUDE_CONFIG_DIR` in that directory's own `settings.json`.
- [Claude Code CLI configuration](https://code.claude.com/docs/en/settings) — `CLAUDE_CONFIG_DIR`
  environment variable contract.
- [Explore the .claude directory](https://code.claude.com/docs/en/claude-directory) — "If you set
  `CLAUDE_CONFIG_DIR`, every `~/.claude` path on this page lives under that directory instead,"
  including the documented `~/.claude/plugins` path ("Cloned marketplaces, installed plugin
  versions, and per-plugin data, managed by `claude plugin` commands").
- [Claude Code plugins](https://code.claude.com/docs/en/plugins-reference) — user-scope
  (`--scope user`) plugin/marketplace state is declared in `~/.claude/settings.json`, which the
  `claude-directory` doc above confirms moves under `CLAUDE_CONFIG_DIR` too.

> **Task 086 verified this core assumption twice before implementing against it** — once against
> the current documentation (both quotes above, fetched 2026-09-02) and once empirically: with a
> disposable `CLAUDE_CONFIG_DIR` under this repo's own scratch directory (never `~/.claude` or any
> real Bitterless-managed profile) and a throwaway marketplace/plugin fixture,
> `claude plugin marketplace add`, `claude plugin install`, and `claude plugin list --json`/
> `marketplace list --json` all read and wrote exclusively under the isolated directory
> (`settings.json`, `plugins/known_marketplaces.json`, `plugins/marketplaces/`,
> `plugins/cache/<marketplace>/<plugin>/<version>/`) — the real ambient `~/.claude` never gained or
> lost any trace of the probe, in either direction. See the task file's Implementation evidence for
> the full transcript. This confirms `CLAUDE_CONFIG_DIR` scopes plugin/marketplace registration
> exactly as this document assumes; no contradicting evidence was found.
