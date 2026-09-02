---
id: eyes-on-agents-iterm2-hook-capture-081-1
status: pass
reviewed_task: eyes-on-agents-iterm2-hook-capture-081
target: working-tree-2026-09-02
date: 2026-09-02
review_type: contract-and-test-audit
---

# Independent Review — eyes-on-agents-iterm2-hook-capture-081

## Verdict

**PASS.** The V3 payload/event types match the feature doc's "Hook payload schema (V3)" code block
exactly. `terminalApp`/`terminalSessionId` are attached only for `SessionStart` and only when both
`TERM_PROGRAM === 'iTerm.app'` and a well-formed `ITERM_SESSION_ID` are present; a missing or
malformed value degrades to the field-absent shape without throwing. V1/V2 parsing is verified
byte-for-byte unchanged for real fixtures by tracing the refactored `parseClaudeHookEvent` branch by
branch against the pre-change implementation. `toMetadataOnlyClaudeHookDelivery` and the outbox
bounds carry the new fields through unstripped. The documented deviation (only `SessionStart` bumps
to `schemaVersion 3`; every other event delegates to the unchanged `createClaudeHookEventV2`) is
implemented as described, and `eyesOnAgents.service.ts`'s "Store latest user question" gate really
does read `event.schemaVersion === 2` for `UserPromptSubmit` — confirmed by reading the source, not
by trusting the task's evidence. No other `schemaVersion` usage in `src/main`/`src/shared` branches
on Claude Hook event/delivery schema in a way this change could break (Codex's own
`schemaVersion === 2`/`=== 1` checks are on unrelated `codexHookBridge.type.ts` types with their own
literal unions). Scope is respected: only the three files in the task's Path plus the new test and
`package.json` wiring were touched; persistence/DAO, `eyesOnAgents.service.ts`, XPC, and the renderer
are untouched. All four verification commands were re-run independently and passed.

## Findings

### P3 — non-blocking

#### 1. `parseClaudeHookEvent` does not require `schemaVersion 3` to be `SessionStart`

- **File:** `src/shared/eyesOnAgents/claudeHookBridge.contract.ts:257-339`
- A payload with `schemaVersion: 3`, `hookEventName: 'UserPromptSubmit'` (or any non-`SessionStart`
  name) and no `terminalApp`/`terminalSessionId` fields parses successfully — it just falls through
  the terminal-fields branch with `terminalFields = null` and returns a `schemaVersion: 3` event that
  is structurally identical to a `schemaVersion: 2` event except for the version tag. The real writer
  (`createClaudeHookEventV3`) never produces this shape — non-`SessionStart` events always delegate to
  `createClaudeHookEventV2` and stay at `schemaVersion: 2` — so this is unreachable from the production
  hook helper. Neither the task file nor the feature doc explicitly forbids it, so this is not a
  contract violation, only a small asymmetry between what the writer guarantees and what the parser
  accepts (relevant if a future consumer round-trips or hand-crafts a `schemaVersion: 3` event for a
  non-`SessionStart` name). No test in the new suite exercises this exact case (it does test the
  inverse — terminal fields on a non-`SessionStart` `schemaVersion: 3` event, which correctly throws).
- Not blocking: no documented behavior is violated, and closing this gap is not required by task 081's
  "Required behavior" or "Verification" sections.

#### 2. `docs/INDEX.md` updated outside the task's declared `Path` list

- **File:** `docs/INDEX.md` (diff: new bullet for `features/eyes-on-agents-iterm2-open.md`)
- The task file's `Path` section lists only the type/contract/helper/test/feature-doc files. The index
  registration for the new feature doc is a one-line addition consistent with this repo's docs-sprint
  convention (every feature doc gets an `INDEX.md` entry) and is not itself source-code scope creep —
  no persistence/service/XPC/renderer code was touched.
- Not blocking: doc-registration housekeeping, not a contract or scope violation.

## Verification re-run (this review, not the developer's report)

- `node --test scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs` → **exit 0**, `tests 9`,
  `pass 9`, `fail 0`.
- `yarn test:eyes-on-agents:bridge` → **exit 0** (`bridge.test.mjs`, `hook-delivery.test.mjs` both
  passed).
- `yarn test:eyes-on-agents:claude` → **exit 0**; the `claude-hook-prompt*` `node --test` group
  (which now includes the new suite) reported `tests 16`, `pass 16`, `fail 0`; every other script in
  the chain (`claude-inventory`, `claude-hook`, `claude-setup-recovery`, legacy-marketplace/admission/
  continuity group, directory-config/runtime/race, provider-toggle/outbox/snapshot/isolation/
  visibility group) also passed.
- `yarn typecheck:eyes-on-agents:core` → **exit 0**, no errors. This config's `include` covers
  `src/shared/eyesOnAgents/**/*.ts` and `src/main/eyesOnAgents/**/*.ts`, so it does type-check the
  `event.schemaVersion === 2` narrowing sites in `eyesOnAgents.service.ts` against the new
  `ClaudeHookEvent` union.

All four commands were executed directly by this reviewer in the current working tree; the developer's
reported pass counts (9 / bridge-pass / 16-in-group / typecheck-pass) match exactly.

## Scope check

Only these files differ from `HEAD`: `docs/INDEX.md`, `package.json`,
`src/main/eyesOnAgents/claudeHookBridge.helper.ts`,
`src/shared/eyesOnAgents/claudeHookBridge.{contract,type}.ts`, plus new files
`docs/features/eyes-on-agents-iterm2-open.md`, `docs/plan/tasks/eyes-on-agents-iterm2-{backend-082,
hook-capture-081,renderer-083}.md`, and
`scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs`. `claudeHookBridge.helper.ts`'s diff is
exactly the one call-site swap (`createClaudeHookEventV2` → `createClaudeHookEventV3`) the task
specified. No persistence/DAO file, `eyesOnAgents.service.ts`, XPC handler, or renderer file appears in
the diff — tasks 082/083 remain untouched and are correctly left at `status: pending`.

## Conclusion

`pass`
