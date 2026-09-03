---
id: eyes-on-agents-claude-multi-env-hook-attribution-087
scope: Capture CLAUDE_CONFIG_DIR on SessionStart (schema V4) and persist it for later environment-label resolution
status: done
depends-on: [eyes-on-agents-claude-multi-env-data-model-084]
verify: focused Claude Hook contract/helper and repository unit tests, Core strict typecheck; no Electron
---

# EyesOnAgents Claude Multi-Environment Hook Attribution

## Objective

Add a fourth Claude Hook payload schema version that captures `process.env.CLAUDE_CONFIG_DIR` at
`SessionStart`, and persist it as a new nullable `claude_config_dir` column on
`eyes_on_agents_thread` via the same independent COALESCE-preserve upsert pattern already used for
`iterm2_session_id`. This task does NOT resolve or store an environment label/id on the thread row —
that join happens at snapshot-read time in task 088, against whatever environments are currently
configured, so a later rename/removal of an environment never requires touching persisted thread
rows.

## Context

- `docs/features/eyes-on-agents-claude-multi-environment.md` — "Hook payload attribution (schema
  V4)" section is the exact contract for this task.
- `docs/plan/tasks/eyes-on-agents-iterm2-hook-capture-081.md`'s "Implementation evidence" — the
  exact V3 pattern (event-conditional optional field, `SessionStart`-only, delegation to the
  unchanged prior-version constructor for every other event) this task repeats one level up.
- `docs/plan/tasks/eyes-on-agents-iterm2-backend-082.md`'s "Implementation evidence" — the exact
  COALESCE-preserve DAO pattern (`thread.iterm2SessionId ?? row?.iterm2_session_id ?? null`) this
  task mirrors independently for `claudeConfigDir`.

## Required behavior

- `src/shared/eyesOnAgents/claudeHookBridge.type.ts` gains `ClaudeHookEventV4Payload` and
  `ClaudeHookEventV4` exactly as specified in the design doc's "Hook payload attribution (schema
  V4)" code block. `ClaudeHookEvent` becomes
  `ClaudeHookEventV1 | ClaudeHookEventV2 | ClaudeHookEventV3 | ClaudeHookEventV4`.
- `src/shared/eyesOnAgents/claudeHookBridge.contract.ts` gains construction/parsing for V4: reading
  `process.env.CLAUDE_CONFIG_DIR` only when `hookEventName === 'SessionStart'`, only when it is a
  non-empty absolute path; anything else produces the field-absent shape, never a thrown error.
  Following the exact V1→V2→V3 delegation precedent: only a genuine `SessionStart` event bumps
  `schemaVersion` to `4`; every other `hookEventName` delegates straight through the unchanged V3
  constructor (which itself still delegates non-`SessionStart` events to the unchanged V2
  constructor, which still delegates to V1's base shape). Do not touch the V3 `terminalApp`/
  `terminalSessionId` capture logic — this task adds a sibling field, not a replacement.
- `toMetadataOnlyClaudeHookDelivery` and outbox quarantine/coverage bounds carry `claudeConfigDir`
  through unchanged — it is a content-free identifier (a local directory path, not prompt or
  transcript content) like `terminalSessionId`, and is not stripped the way `userPromptPreview` is.
- `eyes_on_agents_thread` gains a nullable `claude_config_dir TEXT` column, added through this
  project's existing SQLite migration mechanism (match the immediately-prior column addition —
  `iterm2_session_id`'s migration in task 082 — byte-for-byte in structure: fresh-install
  `CREATE TABLE` parity, idempotent migration function, sequential `versionCode`).
- `upsertClaudeInventory` (`src/preload/sqlite/dao/eyesOnAgents.dao.ts`) accepts an optional
  `claudeConfigDir` field per thread entry and applies the independent COALESCE-preserve rule
  `thread.claudeConfigDir ?? row?.claude_config_dir ?? null` on both insert and update paths — this
  must not interact with, or reuse any logic from, the `desktop_session_id` or `iterm2_session_id`
  preserve rules; all three columns are independent.
- `commitClaudeHookDeliveryInternal` (`src/main/eyesOnAgents/eyesOnAgents.service.ts`) passes
  `claudeConfigDir: payload.claudeConfigDir ?? null` into the existing per-event
  `upsertClaudeInventory` call, alongside the unchanged `desktopSessionId: null` and the existing
  `iterm2SessionId` derivation from task 082.
- Logging: Hook delivery commit logging gains only a boolean ("environment attribution present:
  true/false") — never the raw `claude_config_dir` value. Resolving that boolean/label against the
  configured environments list is task 088's job (service/renderer layer); this task only needs to
  confirm a value was captured, not resolve it to anything.

## Path

- `src/shared/eyesOnAgents/claudeHookBridge.type.ts`
- `src/shared/eyesOnAgents/claudeHookBridge.contract.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (thread type gains `claudeConfigDir: string | null`)
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- the SQLite migration file(s) adding `claude_config_dir`
- a new or extended focused test file under `scripts/eyes-on-agents/` (e.g.
  `claude-hook-environment-attribution.test.mjs`, mirroring
  `claude-hook-terminal-identity.test.mjs`'s structure)
- `docs/integrations/eyes-on-agents.md` (update the `eyes_on_agents_thread` column table with
  `claude_config_dir` in the same change, matching how task 082 updated it for
  `iterm2_session_id`)

## Verification

- New tests cover: `SessionStart` with a valid `CLAUDE_CONFIG_DIR` produces the V4 shape;
  `SessionStart` with an empty/unset value produces the field-absent shape; every non-`SessionStart`
  event never carries `claudeConfigDir` even when the env var is present; V1/V2/V3 fixtures still
  parse unchanged; the DAO COALESCE-preserve rule holds in both directions and does not interact
  with the `desktop_session_id`/`iterm2_session_id` logic; a logged delivery-commit line never
  contains the raw directory value.
- Run the new/extended test file(s), `yarn test:eyes-on-agents:bridge`,
  `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:repository`,
  `yarn test:eyes-on-agents:core`, and `yarn typecheck:eyes-on-agents:core` — all pre-existing tests,
  including the full iTerm2 Open suite from tasks 081-083, must pass unmodified.
- Do not launch Electron.

## Implementation evidence

- `src/shared/eyesOnAgents/claudeHookBridge.type.ts` gains `ClaudeHookEnvironmentFieldAbsent`,
  `ClaudeHookEventV4Payload`, and `ClaudeHookEventV4` exactly as specified in the design doc's "Hook
  payload attribution (schema V4)" code block (`Omit<ClaudeHookEventV3Payload, 'hookEventName'>` per
  branch, closed to `claudeConfigDir: string` only on `SessionStart`). `ClaudeHookEvent` becomes
  `ClaudeHookEventV1 | ClaudeHookEventV2 | ClaudeHookEventV3 | ClaudeHookEventV4`.
  `ClaudeHookMetadataOnlyEvent` gains a fourth union member for V4, following task 081's precedent
  (an explicit `hookEventName`-narrowed two-branch payload rather than a single flattened
  `PayloadBase & PromptAbsent & (...)` type) — extended one further dimension since V4's
  `SessionStart` branch now independently permits terminal identity (`ClaudeHookTerminalFieldsAbsent`
  or present) **and** environment attribution (`ClaudeHookEnvironmentFieldAbsent` or present), each
  varying independently of the other.
- `src/shared/eyesOnAgents/claudeHookBridge.contract.ts` gains:
  - `readClaudeHookEnvironmentAttribution(environment)`: a sibling of task 081's
    `readClaudeHookTerminalIdentity`, reading `environment.CLAUDE_CONFIG_DIR` verbatim (no
    trim/normalize) and returning `{ claudeConfigDir } | null` — non-empty and `isAbsolute` only,
    never throws.
  - `createClaudeHookEventV4(params)`: for a genuine `SessionStart` event, reads both
    `readClaudeHookTerminalIdentity` (unchanged, task 081) and `readClaudeHookEnvironmentAttribution`
    (new) off the same resolved `environment` and merges whichever of the two are present into the
    base payload at `schemaVersion: 4`. Every other `hookEventName` delegates straight through the
    unchanged `createClaudeHookEventV3` (which itself still delegates to the unchanged
    `createClaudeHookEventV2`/`createClaudeHookEvent`), exactly mirroring the V1→V2→V3 delegation
    discipline one level up. The `SessionStart` branch does not call `createClaudeHookEventV3`
    internally — it reads both SessionStart-only facts directly off `parsed.payload`, the same way
    `createClaudeHookEventV3` itself never delegated to `createClaudeHookEventV2` for its own
    `SessionStart` branch (SessionStart never carries prompt fields either way).
  - `parseWireClaudeConfigDir` (throwing, wire-parsing counterpart to the non-throwing capture-time
    reader — mirrors `parseTerminalApp`/`parseTerminalSessionId`'s throwing-on-malformed-wire-data
    style): non-empty absolute path only.
  - `parseClaudeHookEvent` now accepts `schemaVersion` 1-4; validates `claudeConfigDir` is present
    only for `SessionStart` and only at `schemaVersion 4` (a `schemaVersion 2` or `3` payload
    carrying it throws `Claude hook events below schemaVersion 4 cannot carry claudeConfigDir`, a
    non-`SessionStart` payload carrying it throws `... only allowed for SessionStart`). Terminal
    identity and environment attribution are independent per-payload facts — either, both, or neither
    may be present on a `SessionStart` payload — validated and reconstructed independently.
  - `toMetadataOnlyClaudeHookEvent` carries `claudeConfigDir` through unchanged when present (not
    stripped, matching `terminalApp`/`terminalSessionId`), independently of whether terminal identity
    is also present.
  - `parseClaudeHookMetadataOnlyDelivery`'s prompt-content guard now also covers
    `schemaVersion === 4`.
- `src/main/eyesOnAgents/claudeHookBridge.helper.ts` swaps its one call site from
  `createClaudeHookEventV3` to `createClaudeHookEventV4`. **This file was not in this task's stated
  Path list**, but it is the only place that actually invokes a version constructor at runtime —
  task 081 swapped this identical call site for the identical reason when V3 shipped. Leaving it on
  V3 would mean `CLAUDE_CONFIG_DIR` is never captured outside tests, defeating the task's objective.
  Because non-`SessionStart` events delegate straight through to `createClaudeHookEventV3`, this swap
  is behavior-preserving for every event except `SessionStart`.
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`: `EyesOnAgentsThread` gains
  `claudeConfigDir: string | null`; `EyesOnAgentsClaudeInventoryThread` gains an *optional*
  `claudeConfigDir?: string | null` (so `claudeObservation.service.ts`'s pre-existing Desktop
  inventory call site, which never carries this fact, needed no change), mirroring
  `iterm2SessionId`'s exact shape from task 082. `EyesOnAgentsClaudeOpenTarget` is untouched — no
  Open action in this task is driven by `claudeConfigDir`.
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` gains `parseEyesOnAgentsClaudeConfigDir`
  (non-throwing on `null`/`undefined`, throwing on a non-empty-non-absolute value), imported and used
  by both `normalizeClaudeInventoryThread` and `toThread()` in the DAO, mirroring
  `parseEyesOnAgentsIterm2SessionId`'s role exactly. Required a new `node:path` `isAbsolute` import in
  this file (not previously imported here); confirmed safe because neither this file nor
  `claudeHookBridge.contract.ts` (which already imports `isAbsolute`) is reachable from the renderer
  bundle.
- `src/preload/sqlite/dao/eyesOnAgents.table.ts` gains a nullable `claude_config_dir TEXT` column on
  the fresh-install `CREATE TABLE`, placed directly after `iterm2_session_id` (byte-for-byte
  structural parity with task 082's addition). `src/preload/sqlite/dao/eyesOnAgents.migration.ts`
  gains a new idempotent `ensureEyesOnAgentsClaudeConfigDirSchema` function mirroring
  `ensureEyesOnAgentsIterm2SessionSchema` exactly (`addColumnIfMissing`, table-exists guard). Wired
  into `src/preload/sqlite/coreSqlite.release.ts`'s `finalizeCoreSqliteSchema` (idempotent path) and
  `coreSqliteMigrations` (new entry `versionCode: '260902150000'`, one past the prior
  `260902120000` and at-or-before the current package.json `version_code` (`260902183310`) —
  `node scripts/sqlite-migrations/audit.mjs` enforces that a migration's versionCode must not be
  newer than the package's recorded build stamp, which an initial wall-clock-derived
  `'260903125153'` violated; corrected after the audit caught it).
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`: `ThreadRow` and `toThread()` carry `claude_config_dir`
  through to every returned `EyesOnAgentsThread`; `getSnapshot()`'s `SELECT` includes the column;
  `normalizeClaudeInventoryThread` parses the incoming optional field; `upsertClaudeInventory` reads
  and writes `claude_config_dir` on both the insert-new-row and update-existing-row paths (select
  statement, `INSERT` column/value list and bind args, the `next` object, the no-op equality guard,
  and the `UPDATE` statement/bind args), applying the independent COALESCE-preserve rule
  `thread.claudeConfigDir ?? row.claude_config_dir` with no ambiguity flag, no cross-row collision
  guard, and no interaction with the `desktop_session_id`/`iterm2_session_id` branches — verified by
  a dedicated `repository.test.mjs` sequence that sets, preserves-on-omit, replaces, and confirms
  independence from both other identity columns in both directions.
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`: `commitClaudeHookDeliveryInternal` gains
  `const claudeConfigDir = delivery.event.schemaVersion === 4 ? delivery.event.payload.claudeConfigDir
  ?? null : null;`, passed as `claudeConfigDir` into the existing per-event `upsertClaudeInventory`
  call alongside the unchanged `desktopSessionId: null` and the existing `iterm2SessionId`
  derivation. **Necessary, related fix (not a scope violation):** that pre-existing `iterm2SessionId`
  derivation narrowed on `delivery.event.schemaVersion === 3` only; since a genuine `SessionStart`
  now legitimately arrives as `schemaVersion: 4` once the helper swap above lands, that check widened
  to `(delivery.event.schemaVersion === 3 || delivery.event.schemaVersion === 4) &&
  delivery.event.payload.terminalApp === 'iterm2'` — otherwise already-shipped iTerm2 attribution
  would silently stop being captured the moment V4 starts flowing. No other part of task 082's
  `iterm2SessionId` logic changed. A new `[claude-hook] event=SessionStart
  environmentAttribution=<boolean>` line is logged from the same `SessionStart` branch — the boolean
  only, never the raw `claudeConfigDir` value, never an environment `id`/`label` (that join is task
  088's job per this task's explicit scope boundary; see the design doc's updated "Implementation
  note (task 087)" under Logging).
- New `scripts/eyes-on-agents/claude-hook-environment-attribution.test.mjs` (11 tests, run via
  `node --test`) covers: `SessionStart` with a valid `CLAUDE_CONFIG_DIR` producing the V4 shape;
  `SessionStart` with an empty/unset/relative value producing the field-absent shape without
  throwing; every non-`SessionStart` event never carrying `claudeConfigDir` even when the env var is
  present; `SessionStart` independently capturing terminal identity and environment attribution in
  every combination (both, either alone, neither); parse-time rejection of `claudeConfigDir` on a
  non-`SessionStart` event and on `schemaVersion` 2/3; metadata-only conversion and a full
  JSON-round-trip preserving both content-free identifiers; V1/V2/V3 fixtures still parsing
  unchanged; an end-to-end check through the real `runClaudeHookHelper` subprocess entry point
  (`SessionStart` emits V4 with `claudeConfigDir`, `UserPromptSubmit` in the same environment stays
  V2 with none); and two `EyesOnAgentsService`-level tests (a trimmed harness modeled on
  `claude-hook-prompt-service.test.mjs`) confirming `commitClaudeHookDelivery` passes the resolved
  `claudeConfigDir` into `upsertClaudeInventory` and that the captured `console.info` log line
  contains only `environmentAttribution=true/false`, never the raw directory string. Wired into
  `package.json`'s `test:eyes-on-agents:claude` script (appended to the existing
  `claude-hook-terminal-identity.test.mjs` `node --test` group).
- `scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs`'s one real-subprocess test updates
  its `schemaVersion` assertion from `3` to `4` for the reason above (the real helper now legitimately
  emits V4 for a genuine `SessionStart`) — this is the only edit to that pre-existing file, and every
  other assertion in it, including `terminalApp`/`terminalSessionId`, is unchanged, mirroring task
  082's precedent of updating exactly one pre-existing test fixture when a new schema version
  legitimately changes real subprocess/service output.
- `scripts/eyes-on-agents/repository.test.mjs` gains: `ensureEyesOnAgentsClaudeConfigDirSchema`
  wired into both the `repairDb` double-run idempotence check and the legacy `oldDb` upgrade-path
  column assertion (mirroring `ensureEyesOnAgentsIterm2SessionSchema`'s exact coverage); and a
  dedicated `upsertClaudeInventory` sequence (via `getSnapshot()`, since `claudeConfigDir` is not on
  `EyesOnAgentsClaudeOpenTarget`) covering the COALESCE-preserve rule in both directions and its
  independence from both `desktop_session_id` and `iterm2_session_id` (setting either of the other
  two identities does not disturb an already-stored `claudeConfigDir`, and vice versa).
- `docs/features/eyes-on-agents-claude-multi-environment.md` updated in this change: an
  "Implementation note (task 087)" records the helper-subprocess wiring requirement and the
  `iterm2SessionId` schemaVersion-check widening described above; a second note corrects the
  section's "Logging" paragraph, which as written implied this task also logs a matched environment
  `id`/`label` — that resolution requires the configured-environments list, which is out of this
  task's stated scope (task 088's job per the Objective's explicit boundary), so task 087's log line
  carries only the boolean.
- `docs/integrations/eyes-on-agents.md`'s `eyes_on_agents_thread` column table gains a
  `claude_config_dir` row, matching how task 082 updated it for `iterm2_session_id`.
- The renderer, watcher, and plugin-install paths were not touched, per this task's explicit scope
  boundary (task 088 and the already-landed 084-086 own them).

## Verification evidence

- `node --test scripts/eyes-on-agents/claude-hook-environment-attribution.test.mjs` — 11 passed.
- `yarn test:eyes-on-agents:bridge` — passed (`bridge.test.mjs`, `hook-delivery.test.mjs`).
- `yarn test:eyes-on-agents:repository` — passed, including the new `claudeConfigDir`
  COALESCE-preserve sequence and migration-audit coverage.
- `yarn test:eyes-on-agents:core` — passed.
- `yarn test:eyes-on-agents:claude` — passed (27 tests in the `node --test` group that now includes
  `claude-hook-environment-attribution.test.mjs`, plus every other script in the full
  `test:eyes-on-agents:claude` chain — 29 tests in the final `node --test` group including
  `claude-iterm2-open.test.mjs`); every pre-existing Claude test, including the full iTerm2 Open
  suite (081-083) and the Claude multi-environment suite (084-086), passed unmodified except the one
  documented `claude-hook-terminal-identity.test.mjs` schemaVersion update.
- `yarn typecheck:eyes-on-agents:core` — passed.
- `node scripts/sqlite-migrations/audit.mjs` — passed (Core migration chain replays cleanly through
  the new `260902150000` entry).
- Also run for extra confidence (not required by this task): `yarn typecheck:eyes-on-agents:ui` and
  `yarn test:eyes-on-agents:ui` — typecheck passed; the test run reproduced exactly the one
  pre-existing, unrelated `ui-source.test.mjs` failure (stale `app.main.ts` bundle-id assertion,
  logged in `docs/plan/backlog.md`) called out by the orchestrator as not in scope for this task —
  every other file in that suite passed.
- Electron, packaged-app, and end-to-end tests were not run, per the task's explicit instruction.

## Review

[Independent review 1](../reviews/eyes-on-agents-claude-multi-env-hook-attribution-087-1.md) passed
with no blocking findings. It specifically re-verified the most safety-critical part of this task —
widening the existing iTerm2 `terminalSessionId` derivation from `schemaVersion === 3` to
`=== 3 || === 4` — by diffing the exact before/after check, confirming it still gates on
`terminalApp === 'iterm2'` and admits no other schema version, and confirming `terminalSessionId`
and `claudeConfigDir` are extracted independently from the same V4 payload with no clobbering. The
already-shipped iTerm2 Open feature does not regress. It also independently re-ran the SQLite
migration audit and confirmed the corrected `260902150000` versionCode is strictly sequential with
no collisions. Two P3 notes were documentation-only (no action needed, not added to backlog).
