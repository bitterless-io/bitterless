---
id: eyes-on-agents-iterm2-hook-capture-081
scope: Capture iTerm2 terminal session identity on SessionStart as a new Claude Hook payload schema version
status: done
depends-on: []
verify: focused Claude Hook contract/helper unit tests, Core strict typecheck; no Electron
---

# EyesOnAgents iTerm2 Hook Capture

## Objective

Add a schema-versioned, event-conditional `terminalApp` / `terminalSessionId` pair to the Claude
Hook payload, populated only on `SessionStart` when the hook subprocess is running inside iTerm2.
This task only touches the Hook payload contract and helper; it does not touch persistence, the
service layer, or the renderer.

## Context

- `docs/features/eyes-on-agents-iterm2-open.md` — "Identity capture" and "Hook payload schema (V3)"
  sections define the exact shape and rules for this task.
- `docs/features/eyes-on-agents-claude-observation.md` — existing Hook contract table this schema
  extends without changing any existing event's normalized transition.

## Required behavior

- `src/shared/eyesOnAgents/claudeHookBridge.type.ts` gains `ClaudeHookEventV3Payload` and
  `ClaudeHookEventV3` exactly as specified in the feature doc's "Hook payload schema (V3)" section.
  `ClaudeHookEvent` becomes `ClaudeHookEventV1 | ClaudeHookEventV2 | ClaudeHookEventV3`.
  `ClaudeHookMetadataOnlyEvent` gains the matching V3 metadata-only variant (payload base plus the
  absent-fields shape), following the same pattern V1/V2 already use.
- `src/shared/eyesOnAgents/claudeHookBridge.contract.ts` gains construction and parsing for the V3
  event: reading `process.env.ITERM_SESSION_ID` only when `hookEventName === 'SessionStart'` and
  `process.env.TERM_PROGRAM === 'iTerm.app'`, validating it against the same
  `w\d+t\d+p\d+:<uuid>` shape the deep-link builder will use (task 082 owns the deep-link builder
  itself; this task only needs a matching validation regex/helper it can share or duplicate — prefer
  a single exported pattern/validator reused by both, to avoid two sources of truth for the shape).
  A missing or malformed value produces the field-absent payload shape, never a thrown error —
  Hook observation must never block Claude Code.
- `toMetadataOnlyClaudeHookDelivery` and `CLAUDE_HOOK_LIVE_MAX_FRAME_BYTES` /
  `CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES` bounds carry the new fields through unchanged; they are
  content-free identifiers, not prompt/transcript content, and are not stripped the way
  `userPromptPreview` is.
- Existing V1 and V2 deliveries (already-committed offline outbox files, in-flight sockets from a
  not-yet-restarted helper) continue to parse and commit exactly as they do today. No migration
  rewrites persisted delivery files.
- No other Hook event (`UserPromptSubmit`, `PermissionRequest`, `Stop`, `StopFailure`, `SessionEnd`)
  ever carries `terminalApp` / `terminalSessionId`.

## Path

- `src/shared/eyesOnAgents/claudeHookBridge.type.ts`
- `src/shared/eyesOnAgents/claudeHookBridge.contract.ts`
- `src/main/eyesOnAgents/claudeHookBridge.helper.ts` (only if the env read needs to move here instead
  of the contract's event constructor — keep it in the contract layer if at all possible, matching
  where `createClaudeHookEventV2` already lives)
- new or extended `scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs`
- `docs/features/eyes-on-agents-iterm2-open.md` (update only if implementation reveals a naming or
  shape correction; the design must not silently drift from the doc)

## Verification

- New focused tests cover: `SessionStart` inside iTerm2 (valid `ITERM_SESSION_ID`) produces the V3
  shape with both fields; `SessionStart` outside iTerm2 (`TERM_PROGRAM` unset/other) produces the
  field-absent shape; `SessionStart` with a malformed `ITERM_SESSION_ID` produces the field-absent
  shape without throwing; every non-`SessionStart` event never carries the fields even when
  `ITERM_SESSION_ID` is present in the environment; V1 and V2 fixtures still parse unchanged.
- Run the new/extended test file directly with `node --test`, then `yarn test:eyes-on-agents:bridge`
  and `yarn test:eyes-on-agents:claude` to confirm no regression in existing Hook delivery/prompt
  tests, plus `yarn typecheck:eyes-on-agents:core`.
- Do not launch Electron. This task has no renderer or Windows/Playwright surface.

## Implementation evidence

- `src/shared/eyesOnAgents/claudeHookBridge.type.ts` gains `ClaudeHookTerminalFieldsAbsent`,
  `ClaudeHookEventV3Payload`, and `ClaudeHookEventV3` exactly as specified in the feature doc's
  "Hook payload schema (V3)" code block (`Omit<ClaudeHookEventV2Payload, 'hookEventName'>` per
  branch, closed to `terminalApp: 'iterm2'` only on `SessionStart`). `ClaudeHookEvent` becomes
  `ClaudeHookEventV1 | ClaudeHookEventV2 | ClaudeHookEventV3`. `ClaudeHookMetadataOnlyEvent` gains a
  third union member for V3, but — unlike the doc's flattened sketch — its payload is written as an
  explicit two-branch union narrowed on `hookEventName` (non-`SessionStart` vs. `SessionStart`)
  rather than a single `PayloadBase & PromptAbsent & (TerminalAbsent | TerminalPresent)` type. The
  flattened shape does not type-check: once `terminalApp`/`terminalSessionId` are actually present
  (the "not stripped" case), TypeScript cannot assign a value whose `hookEventName` is still the wide
  `ClaudeHookEventName` to a payload union whose `'iterm2'`-carrying branch requires the literal
  `'SessionStart'`. Narrowing `hookEventName` per branch (mirroring the real `ClaudeHookEventV3Payload`
  discriminated union) resolves this. This is an internal type shape only; no exported contract
  behavior changes as a result.
- `src/shared/eyesOnAgents/claudeHookBridge.contract.ts` gains:
  - `CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN` (`/^w\d+t\d+p\d+:[0-9A-Fa-f-]{36}$/`, matching the feature
    doc's shape) and `parseClaudeHookIterm2SessionId` (non-throwing, returns `string | null`) — the
    single exported pattern/validator task 082's deep-link builder should reuse instead of redefining
    the shape a second time.
  - `createClaudeHookEventV3(params)`: reads `params.environment ?? process.env` only when the parsed
    `hookEventName === 'SessionStart'`, requires `TERM_PROGRAM === 'iTerm.app'`, and validates
    `ITERM_SESSION_ID` with the pattern above. A missing/malformed value yields the field-absent
    shape; nothing ever throws for this reason. **Naming/shape decision, now also recorded in the
    feature doc:** for every `hookEventName` other than `SessionStart`, `createClaudeHookEventV3`
    delegates to the unchanged `createClaudeHookEventV2` and keeps emitting `schemaVersion: 2` — it
    does not bump every event to `schemaVersion: 3` the way the V1→V2 rollout bumped every event to
    `schemaVersion: 2`. This is required, not optional: `eyesOnAgents.service.ts`'s
    `claudeHookLastUserPromptCandidate`/`hookLastUserPromptCandidate` ("Store latest user question")
    branch on `event.schemaVersion === 2` for `UserPromptSubmit`, and fixing that check is explicitly
    task 082/083's territory, not this task's. Only `SessionStart` — which never carries prompt
    content — moves to `schemaVersion: 3`.
  - `parseClaudeHookEvent` now accepts `schemaVersion` 1, 2, or 3; validates `terminalApp`/
    `terminalSessionId` are provided together, only for `SessionStart`, and only at `schemaVersion 3`
    (a `schemaVersion 2` payload carrying them throws `Claude V2 hook events cannot carry terminal
    identity fields`, a non-`SessionStart` payload carrying them throws `... only allowed for
    SessionStart`). V1/V2 parsing paths and error messages are otherwise byte-for-byte unchanged.
  - `toMetadataOnlyClaudeHookEvent` now carries `terminalApp`/`terminalSessionId` through unchanged
    when present (matching the doc's "not stripped like `userPromptPreview`" requirement), while still
    stripping `userPromptPreview`/`userPromptTruncated` exactly as before.
  - `parseClaudeHookMetadataOnlyDelivery`'s prompt-content guard now also covers `schemaVersion === 3`
    (in addition to the existing `=== 2` check), since V3's payload type structurally inherits V2's
    optional prompt-field capability.
- `src/main/eyesOnAgents/claudeHookBridge.helper.ts` swaps its one call site from
  `createClaudeHookEventV2` to `createClaudeHookEventV3` (env read stays in the contract layer, per
  the task's stated preference — no other helper logic changed). Because non-`SessionStart` events
  delegate straight through to `createClaudeHookEventV2`, this swap is behavior-preserving for every
  event except `SessionStart`.
- `docs/features/eyes-on-agents-iterm2-open.md`'s "Hook payload schema (V3)" section is updated to
  record the `createClaudeHookEventV3` naming and the "only `SessionStart` bumps to `schemaVersion 3`"
  decision described above, so task 082/083 do not assume every delivered event is now V3.
- New `scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs` (9 tests) covers: `SessionStart`
  inside iTerm2 producing the V3 shape with both fields; `SessionStart` outside iTerm2
  (`TERM_PROGRAM` unset or a different value) producing the field-absent shape; `SessionStart` with a
  malformed `ITERM_SESSION_ID` (wrong shape, too short, empty, `undefined`) producing the field-absent
  shape without throwing; every non-`SessionStart` event stays on `schemaVersion 2` with no terminal
  fields even when `ITERM_SESSION_ID` is present; parse-time rejection of terminal fields attached to
  a non-`SessionStart` event and to a `schemaVersion 2` event; metadata-only conversion preserving
  terminal identity through a full JSON round trip; V1/V2 fixtures still parsing unchanged; and an
  end-to-end check through the real `runClaudeHookHelper` subprocess entry point (SessionStart inside
  iTerm2 emits V3 with terminal fields, UserPromptSubmit in the same environment stays V2 with none).
  It is wired into `package.json`'s `test:eyes-on-agents:claude` script (appended to the existing
  `claude-hook-prompt*` `node --test` group) so it runs as part of normal verification.
- Persistence (DAO/schema), `eyesOnAgents.service.ts`'s `commitClaudeHookDeliveryInternal`, XPC, and
  the renderer were not touched, per the task's explicit scope boundary (tasks 082/083 own them).

## Verification evidence

- `node --test scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs` — 9 passed.
- `yarn test:eyes-on-agents:bridge` — passed (`bridge.test.mjs`, `hook-delivery.test.mjs`).
- `yarn test:eyes-on-agents:claude` — passed, including the new suite inside the
  `claude-hook-prompt*` `node --test` group (16 tests in that group, 0 failed); no other existing
  Claude Hook test in this script changed behavior.
- `yarn typecheck:eyes-on-agents:core` — passed.
- Electron, packaged-app, and end-to-end tests were not run, per the task's explicit instruction; this
  task has no renderer or Windows/Playwright surface.

## Review

[Independent review 1](../reviews/eyes-on-agents-iterm2-hook-capture-081-1.md) passed with no
blocking findings; two P3 non-blocking observations were moved to `docs/plan/backlog.md`.
