---
id: eyes-on-agents-claude-multi-env-data-model-084
scope: Move Claude directory config from one scalar to a user-managed list of named environments, with migration and CRUD
status: done
depends-on: []
verify: focused EyesOnAgents service/repository unit tests, Core strict typecheck; no Electron
---

# EyesOnAgents Claude Multi-Environment Data Model

## Objective

Replace `EyesOnAgentsClaudeDirectoryConfig`'s single `{mode, configDirectory}` scalar with a
`schemaVersion: 2` array of named `EyesOnAgentsClaudeEnvironment` entries, migrate existing
persisted config transparently, and add CRUD methods for managing the list. This task only touches
the config/settings layer — it does NOT touch the watcher, plugin install, Hook payload, or renderer;
those are separate tasks (085-088) that depend on this one's types and service methods.

## Context

- `docs/features/eyes-on-agents-claude-multi-environment.md` — "Data model" section is the exact
  contract for this task.
- `docs/features/eyes-on-agents-claude-observation.md` — "Claude directory lifecycle and
  configuration" section (now edited to point at the multi-environment doc) for the existing
  single-directory mechanics this task generalizes.
- `docs/features/application-diagnostics.md` — logging conventions (`electron-log`, `[scope]`
  prefix, no secret/path values) this task's new lifecycle logging must follow.

## Required behavior

- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` gains `EyesOnAgentsClaudeEnvironment` and the
  `schemaVersion: 2` `EyesOnAgentsClaudeDirectoryConfig` shape exactly as specified in the design
  doc's "Data model" code block. Only `environments[0]` may ever have `mode: 'automatic'`; every
  environment added through `addEnvironment` is created with `mode: 'custom'` and a caller-supplied
  `configDirectory`.
- Reading a persisted `schemaVersion: 1` value converts it once into a single-entry
  `schemaVersion: 2` list (`{id: <fresh uuid>, label: 'Default', mode, configDirectory,
  enabled: true}`) and persists the converted value at the same setting key
  (`eyes_on_agents / claude_directory_v1`). A missing value (fresh install) hydrates the same
  single default `automatic`, enabled environment. Do not invent a new setting key.
- `ClaudeDirectoryConfigService` (`src/main/eyesOnAgents/claudeDirectoryConfig.service.ts`) gains:
  `listEnvironments()`, `addEnvironment({ label, configDirectory })`,
  `renameEnvironment({ id, label })`, `removeEnvironment({ id })` (throws when it is the last
  remaining environment), `setEnvironmentEnabled({ id, enabled })`, `chooseCustomDirectory({ id })`
  (reuses the existing native picker, sets that one environment's `mode`/`configDirectory`),
  `useAutomatic({ id })` (only valid for the one environment currently allowed to be automatic;
  reject otherwise with a clear error).
- The generic setting DAO continues not to log setting values — `configDirectory` must never appear
  in a log line. Every environment lifecycle mutation (add/rename/remove/enable/disable, mode
  change) logs one `[claude-environment]` line through the existing Main `electron-log` logger,
  including `id` and `label` but never `configDirectory`.
- XPC surface (registered wherever the existing `changeDirectory`/`useAutomatic`/retry-equivalent
  methods live) gains the environment-scoped equivalents; do not remove or change the meaning of any
  currently-shipped XPC method in this task — later tasks (085/086) are what actually change watcher
  and plugin behavior to consume this new list.

## Path

- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` (if validation/parsing for the new shape
  belongs there, matching where `parseEyesOnAgentsDesktopSessionId`-style validators already live)
- `src/main/eyesOnAgents/claudeDirectoryConfig.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts` (new environment-CRUD XPC registrations only; do not touch
  unrelated methods)
- a new or extended focused test file under `scripts/eyes-on-agents/` covering this service in
  isolation (e.g. `claude-environment-config.test.mjs`)
- `docs/integrations/eyes-on-agents.md` (update if this doc documents the `claude_directory_v1`
  setting shape or XPC surface — add the new methods/shape in the same change)

## Verification

- New tests cover: schemaVersion 1 → 2 migration produces exactly one `Default` `automatic` enabled
  environment with a stable generated `id`; a missing value hydrates the same default; add/rename/
  remove/setEnabled/chooseCustomDirectory/useAutomatic each mutate only the targeted environment and
  persist correctly; removing the last remaining environment throws and does not mutate state;
  `useAutomatic` on a non-eligible environment throws; a captured log call never contains a
  `configDirectory` value (assert on the log call arguments, not just that logging happened).
- Run the new/extended test file, then any existing `test:eyes-on-agents:*` scripts that already
  cover `claudeDirectoryConfig.service.ts` or `EyesOnAgentsClaudeDirectoryConfig` (find them and run
  them — they must not regress), and `yarn typecheck:eyes-on-agents:core`.
- Do not launch Electron.

## Implementation evidence

- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` gains `EyesOnAgentsClaudeEnvironment` and
  redefines `EyesOnAgentsClaudeDirectoryConfig` in place as the `schemaVersion: 2` array shape
  (`{ schemaVersion: 2; environments: EyesOnAgentsClaudeEnvironment[] }`). **Naming deviation from
  the design doc:** the design doc's code block introduced a separate `EyesOnAgentsClaudeDirectoryConfigV2`
  type name alongside the unversioned V1 name; this task's own "Required behavior" text instead
  says the shared type file gains "the `schemaVersion: 2` `EyesOnAgentsClaudeDirectoryConfig`
  shape" — i.e. the existing exported name is repointed at the new shape rather than adding a
  `...V2` sibling. I followed the task file's literal instruction (repoint the name) since every
  consumer already imported `EyesOnAgentsClaudeDirectoryConfig` as "the current directory config
  shape," and updated `docs/features/eyes-on-agents-claude-multi-environment.md`'s code block and a
  new inline note to match. The old schemaVersion 1 scalar shape has no exported type any more; it
  lives only as a private `LegacyClaudeDirectoryConfigV1` interface inside
  `claudeDirectoryConfig.service.ts`, used solely to parse a legacy persisted value during
  migration.
- `ClaudeDirectoryConfigService` (`src/main/eyesOnAgents/claudeDirectoryConfig.service.ts`) was
  rewritten around an internal `environments: EyesOnAgentsClaudeEnvironment[] | null` (replacing
  the old single `config`). `hydrate()` now: (a) on a missing setting, returns one freshly
  generated `Default`/`automatic`/`enabled` environment without writing to SQLite (matches the old
  V1 "fresh install never persists" behavior exactly); (b) on a valid `schemaVersion: 1` value,
  converts it to a one-entry `schemaVersion: 2` list and persists once; (c) on a valid
  `schemaVersion: 2` value, parses and returns it unchanged; (d) on anything else (oversized,
  malformed keys, non-UUID `id`, more than one `automatic` entry, an `automatic` entry not at index
  0, duplicate `id`s, an empty `environments` array, more than `MAX_ENVIRONMENTS = 20` entries),
  returns `{ state: 'invalid' }` exactly like the old service did for a malformed V1 value.
- New CRUD methods `listEnvironments`, `addEnvironment`, `renameEnvironment`, `removeEnvironment`,
  `setEnvironmentEnabled`, `chooseCustomDirectory`, `useAutomatic` match the design doc's
  pseudocode. `removeEnvironment` throws only when it would leave the list empty — it does **not**
  specifically protect `environments[0]` from removal, since the task's own Required-behavior text
  says "throws when it is the last remaining environment" without an index-0 carve-out. Documented
  this precisely in the design doc's Data model section (the design doc's prose had implied
  `environments[0]` itself could never be deleted, which is stricter than what this task specifies
  and what I implemented). A no-op mutation (rename to the same label, `setEnvironmentEnabled` to
  the same value, `useAutomatic` on an already-automatic environment) does not persist or log,
  mirroring the pre-084 "an identical custom choice must not rewrite SQLite" contract.
- **Recovery-from-invalid preservation (not explicitly called out in the design doc, but a hard
  pre-existing invariant from `eyes-on-agents-claude-observation.md`):** the pre-084 service let
  `chooseCustom()`/`useAutomatic()` unconditionally replace a malformed or not-yet-hydrated saved
  value with a fresh one (no id/lookup needed, since there was only ever one directory). The new
  `{ id }`-scoped methods need a known id to identify a specific environment, which does not exist
  when nothing has successfully hydrated. `chooseCustomDirectory`/`useAutomatic` special-case
  `this.environments === null`: they ignore the given `id` and reset to one fresh environment
  (custom with the picked directory, or automatic), exactly restoring the old recovery contract.
  Verified end-to-end by the pre-existing `claude-directory-runtime.test.mjs` "recoverableRuntime"
  scenario (real `ClaudeDirectoryConfigService`, a malformed persisted value, then
  `useAutomaticDirectory()` recovers to `watching`).
- Every mutation persists **before** updating in-memory state (`persist(environments)` calls
  `settings.upsert` first, then assigns `this.environments`), so a failed `upsert` (e.g. SQLite
  unavailable) leaves the previously applied environment list intact — this exactly mirrors the old
  service's `persist(config)` ordering and is asserted by both `claude-directory-config.test.mjs`
  and `claude-environment-config.test.mjs`. An earlier draft mutated `this.environments` before
  calling persist and was caught by the "persistence failure must leave the previously applied
  intent intact" regression test.
- Logging: every lifecycle mutation logs one `[claude-environment] action=<add|rename|remove|enable|
  disable|directory-change|mode-change> id=<id> label="<label>"[ mode=<mode>]` line through a new
  optional `logger?: Pick<Console, 'info'>` constructor dependency (defaults to `console`, matching
  the existing `codexProxy.service.ts` convention so it routes through the already-initialized
  `electron-log` main logger). `configDirectory` is never included in any log argument;
  `chooseCustomDirectory`'s mutation logs `directory-change` and `useAutomatic`'s logs `mode-change`
  (split from a single generic action name for clarity, since the former does not always represent
  an automatic/custom mode flip).
- Implementation details not specified by the design doc, added defensively and noted here rather
  than in the design doc since they are internal bounds, not contract: `MAX_ENVIRONMENTS = 20`
  (rejected by `addEnvironment`), `MAX_LABEL_LENGTH = 80`, and the stored-value byte budget widened
  from the old single-scalar `8_192` to `65_536` bytes to comfortably fit an array of environments.
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` gains `parseEyesOnAgentsClaudeEnvironmentId`,
  `parseEyesOnAgentsClaudeEnvironmentLabel`, and per-XPC-method param parsers
  (`parseEyesOnAgentsAddClaudeEnvironmentParams`, `parseEyesOnAgentsClaudeEnvironmentIdParams`,
  `parseEyesOnAgentsRenameClaudeEnvironmentParams`,
  `parseEyesOnAgentsSetClaudeEnvironmentEnabledParams`), following the existing
  `assertOnlyKeys`/`parseEyesOnAgentsText` pattern used by the Domain param parsers.
- `src/main/xpc/eyesOnAgents.handler.ts` gains `listClaudeEnvironments`, `addClaudeEnvironment`,
  `renameClaudeEnvironment`, `removeClaudeEnvironment`, `setClaudeEnvironmentEnabled`,
  `chooseClaudeEnvironmentDirectory`, `useAutomaticClaudeEnvironment`, registered on the existing
  `EyesOnAgentsHandler` (auto-registered by `electron-xpc` from the class's actual methods, not
  from a TS interface). `addClaudeEnvironment({ label })` reuses the same native directory picker
  as the existing directory XPC methods (extracted into a small `pickClaudeConfigDirectory` helper
  so it is not duplicated) and never accepts a renderer-supplied path, matching the established
  "renderer XPC never supplies a path" rule. The three currently-shipped `changeClaudeDirectory` /
  `useAutomaticClaudeDirectory` / `retryClaudeDirectory` methods are unchanged.
  **Scope decision:** the new methods are **not** added to the shared `EyesOnAgentsApi` interface.
  `EyesOnAgentsService` (`src/main/eyesOnAgents/eyesOnAgents.service.ts`) also declares
  `implements EyesOnAgentsApi`, so adding these 7 methods there would have forced a matching
  ripple into that ~3,000-line out-of-scope file (a new `claudeDirectoryConfig` dependency plus 7
  delegating methods) merely to satisfy the interface, not because any current caller needs it.
  Since `electron-xpc` registers methods by reflecting over the handler class instance rather than
  the TS interface, the new methods are fully registered and callable via XPC today without that
  ripple; extending `EyesOnAgentsApi` (and, if desired, mirroring the methods onto
  `EyesOnAgentsService`) is left for whichever task first wires a renderer emitter against them —
  most likely task 088.
- `src/main/eyesOnAgents/claudeObservation.service.ts` is **not** in this task's Path and its
  watcher logic is untouched, but it directly consumed the old singular
  `EyesOnAgentsClaudeDirectoryConfig` type and the old `chooseCustom()`/`useAutomatic()`/`getCurrent()`
  method names, so the type change made it fail to compile. Minimal, type-only-in-spirit adaptation
  applied: `appliedConfig` and the `resolveDirectory`/`resolve`/`updateResolvedStatus` parameter
  types changed from `EyesOnAgentsClaudeDirectoryConfig` to `EyesOnAgentsClaudeEnvironment` (a
  structural superset carrying the same `mode`/`configDirectory` fields the existing logic already
  reads); `changeDirectory()`/`useAutomaticDirectory()` now resolve `environments[0]`'s `id` via a
  new `resolveDefaultEnvironmentId()` helper and call `chooseCustomDirectory({ id })`/
  `useAutomatic({ id })` instead of the removed bare methods; and `hydrateAndRecover()` reads
  `hydration.config.environments[0]` instead of `hydration.config` directly. This service still
  watches only the sole default environment (`environments[0]`) exactly as before — it was not
  expanded into a multi-environment watcher; that remains task 085. Because two existing test files
  (`scripts/eyes-on-agents/claude-directory-runtime.test.mjs` and
  `scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs`) exercise this service's actual
  runtime behavior (not just its types) against hand-written `directoryConfig` mocks matching the
  old method names, those mocks were updated in the same change to the new method
  names/shapes — this is functional test maintenance, not new production behavior.
- Existing test files updated: `scripts/eyes-on-agents/claude-directory-config.test.mjs` was
  rewritten to assert the new hydrate/migration contract (missing value, V1→V2 migration with a
  generated id and single persist, V2 round-trip with no rewrite, an expanded set of
  schemaVersion 2 malformed shapes, the widened oversized-byte-budget threshold, the symlink case)
  plus a basic `chooseCustomDirectory`/`useAutomatic` mutation round trip (cancel-is-a-no-op,
  identical-choice-does-not-rewrite, persistence-failure-preserves-state) against the real service,
  preserving every assertion the original file made just re-expressed against the new shape/API —
  nothing was weakened. `scripts/eyes-on-agents/claude-directory-runtime.test.mjs` and
  `scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs` had their `directoryConfig` test
  doubles mechanically updated to the new `hydrate`/`listEnvironments`/`chooseCustomDirectory`/
  `useAutomatic` shape; their actual assertions (retry backoff, capability-clear ordering, stop/race
  behavior, malformed-then-recovered status) are unchanged.
- New file `scripts/eyes-on-agents/claude-environment-config.test.mjs` covers the full CRUD matrix
  from the Verification section: add/rename/remove/setEnabled/chooseCustomDirectory/useAutomatic
  each mutating only the targeted environment; add validation (empty label, nonexistent directory)
  rejecting without persisting; `useAutomatic` on a non-default environment rejecting with a clear
  error and not mutating state; removing a non-last environment, then rejecting removal of the
  final remaining one without persisting or mutating state; and a captured-logger assertion that
  every logged line matches `[claude-environment] action=... id=... label="..."` and never contains
  either fixture directory path.
- `package.json`'s `test:eyes-on-agents:claude` script gains
  `node --test scripts/eyes-on-agents/claude-environment-config.test.mjs` in the same position as
  the other directory-config test invocations.

## Verification evidence

- `node --test scripts/eyes-on-agents/claude-environment-config.test.mjs` — 1 passed.
- `node scripts/eyes-on-agents/claude-directory-config.test.mjs` — passed.
- `node scripts/eyes-on-agents/claude-directory-runtime.test.mjs` — passed.
- `node scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs` — passed.
- `yarn test:eyes-on-agents:claude` (full script, now including the new file) — passed: every
  plain-`node` script printed its "tests passed" line and every `node --test` group reported 0
  failures.
- `yarn test:eyes-on-agents:core`, `:repository`, `:project-resolver`, `:app-server`, `:bridge`,
  `:ui` — all passed (run to confirm the shared type/contract change did not regress any other
  eyesOnAgents suite; none of them reference the changed types directly, confirmed by grep before
  running).
- `yarn typecheck:eyes-on-agents:core` (`tsc -p scripts/eyes-on-agents/tsconfig.strict.json`, which
  covers `src/shared/eyesOnAgents/**`, `src/main/eyesOnAgents/**`,
  `src/main/xpc/eyesOnAgents.handler.ts`, and `src/preload/sqlite/dao/eyesOnAgents.*.ts`) — passed
  with 0 errors after the `EyesOnAgentsApi` scope decision above (an earlier attempt that added the
  7 methods to `EyesOnAgentsApi` surfaced a real, pre-existing `EyesOnAgentsService implements
  EyesOnAgentsApi` compile error, which drove that decision).
- Electron was not launched; no E2E/Playwright suite was run, per instruction.

## Review

[Independent review 1](../reviews/eyes-on-agents-claude-multi-env-data-model-084-1.md) passed with
no blocking findings. It confirmed the `EyesOnAgentsApi` gap is real (the renderer emitter is typed
nominally, not structurally) and correctly scoped to this task — task 088 has been amended with an
explicit Path/Required-behavior entry to close it before writing any dependent renderer code. It
also caught two stray sections left in `docs/features/eyes-on-agents-iterm2-open.md` from an earlier
abandoned narrow-scope draft (predating this task, misattributing content to "task 084" under the
old numbering) — corrected in this same commit, folded in as a documentation fix alongside this
task's real changes. Non-blocking findings (a dead `getCurrent()` method, thin promotion-path test
coverage, persist-failure coverage on 2 of 7 CRUD methods) are recorded in `docs/plan/backlog.md`.
