---
id: eyes-on-agents-claude-multi-env-plugin-install-086
scope: Run the existing Claude plugin/hook install-enable-remove flow against a chosen environment's CLAUDE_CONFIG_DIR
status: done
depends-on: [eyes-on-agents-claude-multi-env-data-model-084]
verify: focused EyesOnAgents plugin-bridge unit tests, Core strict typecheck; no Electron
---

# EyesOnAgents Claude Multi-Environment Plugin Install

## Objective

Let the Claude plugin/hook install/enable/remove/status flow target any configured environment's
`CLAUDE_CONFIG_DIR`, by threading an optional `env` override through the CLI runner and adding
`{ environmentId }` to the relevant XPC methods — WITHOUT changing the existing single
`installationId`/socket/outbox continuity/rotation state machine in any way. Every environment
within one Bitterless profile continues to share that one installation identity; this task only
changes which directory the `claude` CLI process runs against.

## Context

- `docs/features/eyes-on-agents-claude-multi-environment.md` — "Plugin / Hook installation per
  environment" section, and its "Scope decisions" section explaining exactly why the
  installation-identity state machine is out of scope here.
- `docs/features/eyes-on-agents-claude-observation.md` — "Claude plugin Hooks" section: read this
  IN FULL before touching `claudePluginBridge.service.ts`. It documents an extremely invariant-dense
  installation-identity/continuity/rotation contract (installationId rotation, trusted-upgrade
  detection, interrupted-setup Repair boundary, coexistence across Bitterless profiles). This task
  must not change any of those rules — it only adds a target-directory parameter to the CLI
  invocation layer beneath them.

## Required behavior

- `claudeCommand.runner.ts`'s CLI invocation gains one additional optional parameter (do not change
  its existing call signature's required arguments): when a target `configDirectory` is given, the
  spawned process's environment is `{ ...process.env, CLAUDE_CONFIG_DIR: configDirectory }`;
  otherwise it is `process.env` unchanged (today's exact behavior, for the one automatic
  environment). Thread this parameter up through `claudePluginBridge.service.ts`'s
  `runClaudeCommand`/`this.runCommand` call sites used by install/enable/remove/status — do not
  change any other behavior in those methods.
- `installClaudeBridge`, `getClaudeBridgeStatus`, `refreshClaudeBridgeStatus`, `removeClaudeBridge`
  (wherever they are registered in `src/main/xpc/eyesOnAgents.handler.ts`) each gain an
  `{ environmentId }` parameter. Each resolves that environment via task 084's
  `ClaudeDirectoryConfigService.listEnvironments()`, passes its `configDirectory` (or `undefined` for
  the one automatic environment) down to the CLI runner, and otherwise runs the existing, byte-for-byte
  unmodified install/enable/remove/status sequence. An unknown `environmentId` is a clear rejected
  error, not a silent fallback to the default environment.
- Do NOT introduce a second `installationId`, a per-environment socket, or a per-environment outbox
  directory. Do NOT change the installation-identity rotation, trusted-upgrade, or interrupted-setup
  Repair logic described in `eyes-on-agents-claude-observation.md`'s "Claude plugin Hooks" section —
  every environment's installed plugin definition still calls the helper with the exact same
  `{ endpoint, installationId, outboxPath }` args used today.
- Logging: extend the existing plugin-bridge mutation/error logging (stage + sanitized error name,
  never raw CLI output/executable path/`configDirectory` value) with the target environment's
  `id`/`label`.

## Path

- `src/main/eyesOnAgents/claudeCommand.runner.ts`
- `src/main/eyesOnAgents/claudePluginBridge.service.ts` (call-site changes only — passing the
  resolved `configDirectory` through; do not touch the installation-identity state machine logic
  itself)
- `src/main/xpc/eyesOnAgents.handler.ts` (add `{ environmentId }` to the four methods listed above)
- a new or extended focused test file under `scripts/eyes-on-agents/` (e.g.
  `claude-environment-plugin-install.test.mjs`)

## Verification

- New tests cover: installing/enabling/removing/checking status for a non-default environment spawns
  the CLI with `CLAUDE_CONFIG_DIR` set to that environment's directory and does not touch the default
  environment's installation state; installing for the automatic environment spawns with no
  `CLAUDE_CONFIG_DIR` override, matching today's exact behavior; an unknown `environmentId` rejects
  cleanly with no CLI spawn attempted.
- Re-run the existing Claude plugin bridge test suite in full (find it — likely covers
  `claudePluginBridge.service.ts`'s installation-identity/continuity rules) and confirm it passes
  completely unmodified; this task must not need to change a single existing assertion there. If it
  does need a change, stop and treat that as a signal this task has drifted into the
  installation-identity state machine, which is explicitly out of scope.
- Run `yarn typecheck:eyes-on-agents:core`.
- Do not launch Electron.

## Implementation evidence

### Core CLAUDE_CONFIG_DIR assumption — verified before writing install-time code

The whole task rests on: does `CLAUDE_CONFIG_DIR` cause `claude plugin marketplace add`/
`claude plugin install`/`claude plugin enable` (`--scope user`) to register into **that
directory's own** settings/plugin state, rather than some ambient/global/`CLAUDE_CONFIG_DIR`-
independent location? Verified twice, both confirming the assumption; no contradicting evidence
found.

**Documentation evidence** (fetched 2026-09-02 from code.claude.com/docs):

- [`/docs/en/claude-directory`](https://code.claude.com/docs/en/claude-directory): "If you set
  [`CLAUDE_CONFIG_DIR`](/docs/en/env-vars), every `~/.claude` path on this page lives under that
  directory instead." The page's file tree explicitly lists `~/.claude/plugins` as "Cloned
  marketplaces, installed plugin versions, and per-plugin data, managed by `claude plugin`
  commands."
- [`/docs/en/settings`](https://code.claude.com/docs/en/settings): "To keep the home-directory
  files somewhere else, set `CLAUDE_CONFIG_DIR`; Claude Code then stores your settings, session
  history, and plugins there instead."
- [`/docs/en/plugins-reference`](https://code.claude.com/docs/en/plugins-reference): `--scope user`
  plugin state is declared in `~/.claude/settings.json` (`enabledPlugins`) — the same file the
  `claude-directory` page above says moves under `CLAUDE_CONFIG_DIR`.

**Empirical evidence** (real `claude` CLI, v2.1.252, found on PATH in this environment). Built a
disposable marketplace fixture (`.claude-plugin/marketplace.json` + one plugin's
`.claude-plugin/plugin.json`, following the exact shape `claudePluginBridge.service.ts` writes)
under this session's own scratchpad directory, and a separate disposable `CLAUDE_CONFIG_DIR` under
the same scratchpad — never touching the real `~/.claude` or any Bitterless-managed profile:

```
CLAUDE_CONFIG_DIR=<scratch>/claude-config-dir-probe claude plugin marketplace add <scratch>/probe-marketplace --scope user
  → "Successfully added marketplace: bitterless-probe-marketplace (declared in user settings)"
CLAUDE_CONFIG_DIR=<scratch>/claude-config-dir-probe claude plugin marketplace list --json
  → [{ "name": "bitterless-probe-marketplace", "source": "directory", "path": ".../probe-marketplace" }]
claude plugin marketplace list --json   (no CLAUDE_CONFIG_DIR — the real ambient ~/.claude)
  → does not contain "bitterless-probe-marketplace" (before AND after the isolated-dir add)
find <scratch>/claude-config-dir-probe
  → .claude.json, backups/, plugins/known_marketplaces.json, plugins/marketplaces/, settings.json
    (all created fresh under the isolated directory by the marketplace add alone)

CLAUDE_CONFIG_DIR=<scratch>/claude-config-dir-probe claude plugin install probe-plugin@bitterless-probe-marketplace --scope user
  → "Successfully installed plugin: probe-plugin@bitterless-probe-marketplace (scope: user)"
CLAUDE_CONFIG_DIR=<scratch>/claude-config-dir-probe claude plugin list --json
  → [{ "id": "probe-plugin@bitterless-probe-marketplace", "scope": "user", "enabled": true,
       "installPath": ".../claude-config-dir-probe/plugins/cache/bitterless-probe-marketplace/probe-plugin/0.0.1" }]
claude plugin list --json   (real ambient ~/.claude)
  → does not contain "probe-plugin" (before AND after)

grep -ril "bitterless-probe|probe-plugin" ~/.claude   → clean (no residue at all)
```

Both marketplace registration and plugin installation wrote **exclusively** under the isolated
`CLAUDE_CONFIG_DIR` (`settings.json`, `plugins/known_marketplaces.json`, `plugins/marketplaces/`,
`plugins/cache/...`) and were **completely invisible** to the real ambient `~/.claude` in both
directions. The disposable directory and marketplace fixture were deleted immediately after
(`rm -rf`); nothing was left behind, and the real Bitterless Claude installation/marketplace was
never touched.

**Conclusion: the design's core assumption holds.** `CLAUDE_CONFIG_DIR` fully relocates
`~/.claude` — including `settings.json` (where `--scope user` plugin/marketplace declarations live)
and `plugins/` (where marketplace clones and installed plugin versions live) — so threading a
resolved `configDirectory` into the `claude` CLI's spawned environment is the correct mechanism for
this task. Implementation proceeded as specified.

### Changed files

- `src/main/eyesOnAgents/claudeCommand.runner.ts` — `runClaudeCommand`'s existing third `options`
  object gains one more optional field, `configDirectory?: string | null`. When set, the spawned
  child's `env` is `{ ...process.env, CLAUDE_CONFIG_DIR: configDirectory }`; otherwise `env` is
  `process.env` unchanged (byte-for-byte identical to pre-086 behavior, verified by a real-spawn
  test comparing against the actual live `process.env.CLAUDE_CONFIG_DIR` value — see below). No
  other change; `executable`/`args` and the existing `timeoutMs`/`maxOutputBytes` fields, defaults,
  and all timeout/output-limit/kill logic are untouched.
- `src/main/eyesOnAgents/claudePluginBridge.service.ts` — call-site changes only, exactly as scoped.
  Every method that transitively reaches the CLI (`install`, `refresh`, `remove`,
  `refreshWithoutAutomaticUpgrade`, `inspectCurrent`, `performTrustedAutomaticUpgrade`,
  `performInstall`, `recoverLegacyProductionDebugMarketplace`, `inspectClaudeNamespace`, and the
  private `command()` wrapper) gained one additional optional `configDirectory?: string` parameter,
  threaded straight through to the next call, terminating at `command()`'s
  `this.runCommand(executable, args, { timeoutMs, maxOutputBytes, configDirectory })`. Verified by a
  script (`awk` scan of every `this.command(executable, [...])` call site) that every single one
  now passes `configDirectory` — no call site was missed. Deliberately **not** threaded into
  `resolveExecutable()`'s two capability-probe commands (`plugin --help`,
  `plugin marketplace remove --help`) — see the design doc's new implementation note for why. No
  installation-identity/continuity/rotation branch, ordering, or condition was touched; every
  existing assertion in the four pre-086 plugin-bridge test files still passes unmodified (see
  Verification evidence).
- `src/main/eyesOnAgents/claudeBridgeEnvironment.resolver.ts` (**new, not in the task's Path** — see
  deviation below) — one small, pure, exported `resolveClaudeBridgeEnvironment(environments,
  params?)` function: an omitted/`{}` `params.environmentId` resolves to `environments[0]`; a
  supplied id must match a real entry or it throws `'Claude environment was not found'` (the exact
  message `claudeDirectoryConfig.service.ts`'s own CRUD methods already use for the same condition,
  for consistency). No Electron dependency, so it is directly unit-testable without booting the
  Electron-coupled `eyesOnAgents.handler.ts` module.
- `src/main/eyesOnAgents/claudeBridgeLog.helper.ts` (**new, not in the task's Path** — see deviation
  below) — one small, pure, exported `logClaudeBridgeAction(action, environment, error?, logger =
  console)` function producing `[claude-bridge] action=<install|refresh|remove|status>
  id=<id> label="<label>"[ error=<sanitized, 300-char-bounded>]`; `configDirectory`, raw CLI output,
  and the executable path never appear. Takes an injectable `logger` (default `console`, matching
  `claudeDirectoryConfig.service.ts`'s established DI convention) so its output is directly
  assertable in tests without capturing global `console`.
- `src/main/xpc/eyesOnAgents.handler.ts` — `installClaudeBridge`, `refreshClaudeBridgeStatus`,
  `removeClaudeBridge`, `getClaudeBridgeStatus` each gain an optional `params?: { environmentId?:
  string }`. Each resolves the environment via `resolveClaudeBridgeEnvironment(
  claudeDirectoryConfig.listEnvironments(), parseEyesOnAgentsClaudeBridgeEnvironmentParams(params))`
  (an unknown id throws before any further call), then passes `environment.configDirectory ??
  undefined` to the matching `EyesOnAgentsService` method (except `getClaudeBridgeStatus`, which
  needs no configDirectory — see below), and logs via `logClaudeBridgeAction` on success (mutations
  only) and on error (all four).
- `src/main/eyesOnAgents/eyesOnAgents.service.ts` (**touched despite not being in the task's Path**
  — see deviation below) — `installClaudeBridge`, `refreshClaudeBridgeStatus`, `removeClaudeBridge`
  each gained one additional optional `configDirectory?: string` parameter, passed straight through
  to `this.dependencies.claudeBridge?.install(configDirectory)`/`.refresh(configDirectory)`/
  `.remove(configDirectory)` (the `claudeBridge` dependency type's three methods gained the matching
  optional parameter). No other line in any of these three ~15–100-line methods changed — the
  Claude-provider-management guards, the shared Hook listener stop/start sequencing, and every
  `isClaudeProviderManagementCurrent`/`isClaudeProviderRuntimeCurrent` fence are byte-for-byte
  unchanged. `getClaudeBridgeStatus` was **not** touched — it only reads `claudeBridge.getStatus()`
  (no CLI call), so there is nothing for a `configDirectory` to scope.
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` — new
  `parseEyesOnAgentsClaudeBridgeEnvironmentParams(value)`: `undefined` → `{}`; otherwise an object
  with only an optional `environmentId` key, validated as a real UUID via the existing
  `parseEyesOnAgentsClaudeEnvironmentId` when present. Follows the file's established
  `assertOnlyKeys`/`isEyesOnAgentsRecord` pattern.
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` — **not changed** in the end (an earlier attempt to
  add `params?: { environmentId?: string }` to `EyesOnAgentsApi`'s four method signatures was
  reverted — see deviation below).
- `package.json` — `test:eyes-on-agents:claude` gains
  `node scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs`, grouped with the other
  plugin-bridge test invocations (right after `claude-update-continuity.test.mjs`), matching task
  084's precedent for registering its own new test file.
- `docs/features/eyes-on-agents-claude-multi-environment.md` — corrected the `runClaudeCommand`
  pseudocode (it dropped the required `executable` argument and the existing options shape) and
  added four implementation notes to "Plugin / Hook installation per environment" (the
  `configDirectory` threading mechanism and the deliberately-unscoped help probes; the
  optional-`environmentId`/unchanged-`EyesOnAgentsApi` decision; the real orchestration living in
  `eyesOnAgents.service.ts`; the logging-is-new finding), plus a note under "Sources" recording both
  the documentation and empirical verification of the core `CLAUDE_CONFIG_DIR` assumption.
- `scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs` (new) — see Verification
  evidence.

### Deviations from the task file's literal text (documented precisely, per instruction)

1. **`{ environmentId }` is optional, not required**, on all four `EyesOnAgentsHandler` methods —
   an omitted value resolves to `environments[0]`. The task's Required-behavior text reads as if
   the parameter is always supplied; making it required would have forced updating
   `ClaudeObservationCard.vue`'s and `eyesOnAgents.store.ts`'s three existing zero-argument call
   sites (`installClaudeBridge()`, `refreshClaudeBridgeStatus()`, `removeClaudeBridge()`) to pass a
   real id, which is renderer work explicitly out of this task's scope. This preserves 100% of
   today's renderer behavior (`yarn typecheck:eyes-on-agents:ui` and `yarn test:eyes-on-agents:ui`
   both still pass, 75/75, with zero renderer file changes) while still fully implementing
   environment-scoped behavior for an explicitly supplied id, including clean rejection of an
   unknown one. Recorded as an implementation note in the design doc.
2. **`EyesOnAgentsApi` (the shared XPC interface) was left unchanged**, still declaring these four
   methods with zero parameters. Both `EyesOnAgentsHandler` and `EyesOnAgentsService` separately
   declare `implements EyesOnAgentsApi`; giving the interface a `params?: { environmentId?: string
   }` signature while `EyesOnAgentsService`'s internal methods needed a structurally different
   `configDirectory?: string` parameter produced a genuine `TS2416` compile error (confirmed by
   trying it: `tsc` reported `Type '(configDirectory?: string) => ...' is not assignable to type
   '(params?: { environmentId?: string }) => ...'`) — this is exactly the ripple task 084's own
   evidence described avoiding for its new CRUD methods. Since a class method with an *additional
   optional* parameter still satisfies a narrower interface member (still callable with zero
   arguments), leaving `EyesOnAgentsApi` untouched keeps both `implements` clauses valid with no
   ripple, and `electron-xpc` registers methods by reflecting on the class instance rather than the
   TS interface (confirmed by reading `node_modules/electron-xpc/dist/main/index.js`), so the new
   optional parameter is fully live over XPC today regardless.
3. **`src/main/eyesOnAgents/eyesOnAgents.service.ts` was touched**, though it is not in the task's
   Path list. Tracing the actual pre-086 call graph (`EyesOnAgentsHandler.installClaudeBridge()` →
   `eyesOnAgentsService.installClaudeBridge()` → `this.dependencies.claudeBridge?.install()`) shows
   the real "install/enable/remove/status sequence" the task calls "existing, unmodified" is owned
   by `EyesOnAgentsService`, not solely by `claudePluginBridge.service.ts` — the handler alone has
   no path to the CLI layer. Without this minimal, additive, three-line-per-method change, a
   resolved `configDirectory` could never reach `runClaudeCommand`, so the task's Required behavior
   could not be satisfied end to end from the Path list alone. Kept surgical: three optional
   parameters added, zero other lines touched, matching task 085's identical precedent of extending
   `eyesOnAgents.handler.ts` beyond its own Path list where the end-to-end contract required it.
4. **`resolveExecutable()`'s two capability-probe commands are not environment-scoped** —
   documented above and in the design doc's implementation note.
5. **Two new small files** (`claudeBridgeEnvironment.resolver.ts`, `claudeBridgeLog.helper.ts`) were
   added beyond the task's Path list, both consumed only by `eyesOnAgents.handler.ts`. They exist so
   the environment-resolution and logging logic added to that Electron-coupled, hard-to-unit-test
   module is itself directly unit-testable (no Electron dependency), rather than being inline,
   untested logic inside a module whose import triggers `app.getPath(...)` at load time.

### Test file

`scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs` (plain `node`, esbuild-bundled
imports, matching the established pattern in `claude-inventory.test.mjs`/
`claude-setup-recovery.test.mjs`) covers, against the real modules (no reimplementation):

- `runClaudeCommand`: a real child process reports `process.env.CLAUDE_CONFIG_DIR` — omitted and
  `null` both reproduce the live ambient value unchanged (compared against the actual
  `process.env.CLAUDE_CONFIG_DIR` of this test run, not a hardcoded assumption, since this very
  sandbox already exports one); a given value is observed verbatim in the child; other ambient vars
  (`PATH`) still pass through, proving the override extends `process.env` rather than replacing it.
- `ClaudePluginBridgeService.install(configDirectory)` for a non-default environment: every captured
  `runCommand` call except the two help probes carries that exact `configDirectory`; the help probes
  carry `undefined`. A sanity assertion confirms the mocked sequence actually reached `plugin
  marketplace add` (i.e., the scoping assertion isn't vacuously true over zero relevant calls).
- `install(undefined)` for the automatic environment: every single captured call (including the help
  probes) carries `undefined` — matching today's exact behavior.
- `refresh(configDirectory)` and `remove(configDirectory)` on an already-installed harness: same
  per-call scoping assertion.
- Two independent harnesses run concurrently (one default, one custom) prove `configDirectory` is a
  plain per-call argument, not shared/cached instance state — the default harness's calls never see
  the custom directory and vice versa.
- `resolveClaudeBridgeEnvironment`: omitted/`{}` → `environments[0]`; a real id → that environment;
  an unknown id → throws; an empty environments list → throws.
- An unknown `environmentId`, resolved through the exact same resolve-then-call sequence
  `eyesOnAgents.handler.ts` uses, rejects with zero CLI commands issued (`harness.calls.length ===
  0`) — directly proving "no CLI spawn attempted."
- `logClaudeBridgeAction`: success and error lines match the exact `[claude-bridge] action=...
  id=... label="..."[ error=...]` shape; neither ever contains the environment's `configDirectory`
  value; a 1,000-character error message is bounded well under 500 characters in the logged line.

### Verification evidence

- `node scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs` — passed (all 8 numbered
  scenarios above).
- `node scripts/eyes-on-agents/claude-update-continuity.test.mjs` — passed, 5/5, **unmodified**.
- `node scripts/eyes-on-agents/claude-setup-recovery.test.mjs` — passed, **unmodified**.
- `node scripts/eyes-on-agents/claude-hook.test.mjs` — passed, **unmodified**.
- `node --test scripts/eyes-on-agents/claude-legacy-marketplace-recovery.test.mjs` — passed, 6/6,
  **unmodified**. Zero assertions in any of these four pre-086 files needed to change.
- `yarn test:eyes-on-agents:claude` (full script, now including the new file) — passed: every group
  reported 0 failures, confirmed by grepping the full output for `fail [1-9]` (no matches) after
  redirecting to a log file.
- `yarn test:eyes-on-agents` (full suite: core, project-resolver, repository, app-server, bridge,
  claude, ui) — passed, exit code 0, 0 failures across every reporting group (75/75 in the UI
  group, confirming the deliberate choice to leave `EyesOnAgentsApi`/the renderer untouched produced
  no regression).
- `yarn typecheck:eyes-on-agents:core` — passed, 0 errors.
- `yarn typecheck:eyes-on-agents:ui` — passed, 0 errors (run defensively, not required by this
  task's Verification section, specifically to rule out the kind of silent renderer regression task
  085 needed a review pass to catch).
- Electron was not launched. No E2E/Playwright suite was run. The only process-spawning "test" was
  the narrow, disposable, scratch-directory `CLAUDE_CONFIG_DIR` research probe described above (real
  `claude` CLI, real spawns, entirely under this session's own scratchpad, deleted immediately after
  use) — a research probe verifying the task's core assumption, not an E2E/Playwright suite, and it
  never touched this machine's real `~/.claude` or any Bitterless-managed Claude installation.

## Review

[Independent review 1](../reviews/eyes-on-agents-claude-multi-env-plugin-install-086-1.md) passed
with no blocking findings. It independently re-ran the core `CLAUDE_CONFIG_DIR` assumption probe
with a fresh disposable directory and fresh names, checking absence in both this sandbox's own
ambient `CLAUDE_CONFIG_DIR` and the true real `~/.claude` — same conclusion as the original probe,
now doubly-verified since this is the highest-risk assumption in the whole plan. It also caught a
real internal inconsistency in task 088's plan (widening `EyesOnAgentsApi`'s 4 pre-existing bridge
methods to `{ environmentId }` would break `EyesOnAgentsService`'s `implements EyesOnAgentsApi`
unless that service's own bridge-method signatures are updated too) — task 088's file has been
corrected with the exact fix. Two P3 non-blocking notes (a stray blank-line insertion, and the new
test harness not directly exercising the `plugin enable` CLI branch even though the call-site scan
confirmed it's threaded correctly) are recorded in `docs/plan/backlog.md`.
