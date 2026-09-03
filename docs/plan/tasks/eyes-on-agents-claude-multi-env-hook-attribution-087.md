---
id: eyes-on-agents-claude-multi-env-hook-attribution-087
scope: Capture CLAUDE_CONFIG_DIR on SessionStart (schema V4) and persist it for later environment-label resolution
status: in-progress
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
