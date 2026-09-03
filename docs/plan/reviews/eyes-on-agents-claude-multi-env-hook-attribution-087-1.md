# Review 1 — eyes-on-agents-claude-multi-env-hook-attribution-087

Reviewer: independent review pass (no source edits, no Electron/E2E run).

Context note: at review time, `git status` showed only 7 files with an uncommitted diff
(`docs/features/eyes-on-agents-claude-multi-environment.md`, `docs/integrations/eyes-on-agents.md`,
the task file itself, `package.json`, `scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs`,
`scripts/eyes-on-agents/repository.test.mjs`, `src/preload/sqlite/coreSqlite.release.ts`) plus one
untracked test file (`scripts/eyes-on-agents/claude-hook-environment-attribution.test.mjs`). The
core implementation files named in the task's Path list and in the "helper.ts call-site swap"
deviation (`claudeHookBridge.type.ts`, `claudeHookBridge.contract.ts`, `eyesOnAgents.type.ts`,
`eyesOnAgents.contract.ts`, `eyesOnAgents.service.ts`, `claudeHookBridge.helper.ts`,
`eyesOnAgents.dao.ts`, `eyesOnAgents.table.ts`, `eyesOnAgents.migration.ts`) show **no diff against
HEAD** — they were already folded into HEAD by two of the automated "chore: sync" commits
(`b1221f2` "chore: sync 2026-09-03 12:56" carries the `claudeHookBridge.helper.ts` swap and the
shared type/contract additions; `c7802cd` "chore: sync 2026-09-03 12:59" carries the
`eyesOnAgents.service.ts` widening). This matches the task's own note that this branch has had
several sync commits land during the session, and does not change the review outcome — I verified
the actual code and its history (`git show <commit> -- <file>`) rather than relying on a
working-tree diff for those files. All findings below are based on the code actually present on
disk (and its commit history), not on assumed diffs.

## Findings

### Priority investigation 1a — `claudeHookBridge.helper.ts` call-site swap (V3→V4)

- **P3, non-blocking.** `docs/plan/tasks/…-087.md:138-144` and the design doc's "Implementation note
  (task 087)" (`docs/features/eyes-on-agents-claude-multi-environment.md:343-358`) both correctly
  describe this deviation. Verified independently: commit `b1221f2` changed exactly two lines in
  `src/main/eyesOnAgents/claudeHookBridge.helper.ts` — the import (`createClaudeHookEventV3` →
  `createClaudeHookEventV4`) and the one call site (line ~107). No other line in that file changed.
  This is a real, necessary fix and a minimal one-call-site change, exactly as claimed, and mirrors
  task 081's precedent of swapping the identical call site for the identical reason.
- Delegation-chain trace confirms non-`SessionStart` events are byte-identical to pre-087 behavior:
  `createClaudeHookEventV4` (`src/shared/eyesOnAgents/claudeHookBridge.contract.ts:261-285`) returns
  `createClaudeHookEventV3(params)` unchanged for any `hookEventName !== 'SessionStart'`
  (line 270), which itself returns `createClaudeHookEventV2(params)` unchanged for the same
  condition (line 236), which itself only special-cases `UserPromptSubmit` (line 203) and otherwise
  emits the plain V2 metadata payload (line 204). No new code path or side effect is introduced
  for V1/V2/V3-shaped events; the same `params` object (including `environment`) is forwarded
  unchanged at each level, and each level re-checks `hookEventName` independently, so there is no
  double-read or divergent branching hazard.

### Priority investigation 1b — `eyesOnAgents.service.ts` iterm2SessionId widening (`=== 3` → `=== 3 || === 4`)

- **Not blocking — verified correct.** Read the actual before/after via `git show c7802cd --
  src/main/eyesOnAgents/eyesOnAgents.service.ts`. Before:
  `delivery.event.schemaVersion === 3 && delivery.event.payload.terminalApp === 'iterm2'`. After:
  `(delivery.event.schemaVersion === 3 || delivery.event.schemaVersion === 4) &&
  delivery.event.payload.terminalApp === 'iterm2'` (current file,
  `src/main/eyesOnAgents/eyesOnAgents.service.ts:3086-3090`). The claim that the old check really was
  `=== 3` only, and really would have silently excluded V4 SessionStart payloads once the helper
  swap lands, is confirmed by the commit history — this is a real regression that the widening
  correctly prevents.
- The widened check does **not** admit any other schemaVersion (only 3 or 4 are OR'd; 1 and 2 are
  still excluded) and still requires `payload.terminalApp === 'iterm2'`, so a V4 SessionStart with
  no terminal identity (or a different/absent `TERM_PROGRAM`) still correctly yields `null` for
  `iterm2SessionId`. The type structure supports this safely:
  `ClaudeHookEventV4Payload` (`src/shared/eyesOnAgents/claudeHookBridge.type.ts:88-99`) is built from
  `Omit<ClaudeHookEventV3Payload, 'hookEventName'>`, so `terminalApp`/`terminalSessionId` are
  inherited verbatim into the V4 payload shape — the field is not renamed, moved, or reinterpreted
  by V4.
- **Same-payload, independent-extraction trace confirmed.** Both `iterm2SessionId` and
  `claudeConfigDir` are computed as two separate local `const`s
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:3086-3095`) reading two different, non-overlapping
  key paths (`payload.terminalSessionId` vs. `payload.claudeConfigDir`) off the *same*
  `delivery.event.payload` object. Neither assignment mutates the payload or the other constant.
  Both are then passed as sibling fields into the same `upsertClaudeInventory` call
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:3105-3106`), and the DAO's COALESCE-preserve logic
  keeps them on fully independent columns with independent no-op/update logic
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:2215-2218`, `2239-2242`, `2253-2266`) — confirmed by
  the `repository.test.mjs` sequence added in this task
  (`scripts/eyes-on-agents/repository.test.mjs:3459-3524`), which explicitly asserts that setting
  `iterm2SessionId` does not disturb an already-stored `desktop_session_id` **or** `claudeConfigDir`,
  and vice versa. Real, genuine SessionStart-in-iTerm2-with-CLAUDE_CONFIG_DIR-set is exercised
  end-to-end through the real subprocess helper in
  `scripts/eyes-on-agents/claude-hook-environment-attribution.test.mjs:90-127` ("SessionStart
  captures terminal identity and environment attribution independently of each other"), which
  asserts both `terminalApp`/`terminalSessionId` and `claudeConfigDir` are present together on one
  V4 payload with neither clobbering the other. **Conclusion: the widening is correct and complete;
  the already-shipped iTerm2 Open feature does not regress.**

### Priority investigation 2 — versionCode audit fix

- **Not blocking — verified correct.** `node scripts/sqlite-migrations/audit.mjs` was re-run
  independently and passes (exit code 0; "SQLite migration audit passed (14 Core + 7 Maestro + 10
  Todoist sync + 8 Trench baselines)").
- Full `coreSqliteMigrations` list read end-to-end
  (`src/preload/sqlite/coreSqlite.release.ts:142-228`): versionCodes are strictly increasing with no
  collision, ending `…, 260818190001 (ensureEyesOnAgentsClaudeDeletionSchema), 260902120000
  (ensureEyesOnAgentsIterm2SessionSchema — task 082), 260902150000
  (ensureEyesOnAgentsClaudeConfigDirSchema — task 087)`. `package.json`'s `version_code` is
  `260902183310`, which is after `260902150000`, satisfying the audit's "migration versionCode must
  not be newer than the package's build stamp" rule. Confirmed tasks 084-086 (data-model,
  watcher, plugin-install) added no `coreSqliteMigrations` entries of their own (grepped their task
  files for `coreSqliteMigrations`/`coreSqlite.release` — no hits), so there is no interleaving
  ordering question to resolve; 087's entry correctly sits immediately after 082's.
- The fix is a pure one-line value correction in
  `src/preload/sqlite/coreSqlite.release.ts` (`'260903125153'` → `'260902150000'`), confirmed via
  `git diff` — no other file or line changed as a side effect.

### Standard checks

- **P3, non-blocking, doc nit.** The design doc's "Logging" implementation note
  (`docs/features/eyes-on-agents-claude-multi-environment.md:375-381`) is clear and consistent with
  the code, but the *un-corrected* prose immediately above it (line 370-373) still reads "gains only
  whether attribution matched a known environment (boolean) plus that environment's `id`/`label`
  when matched" — i.e. the original (now superseded) sentence was left in place with the correction
  appended as a blockquote rather than amending the sentence itself. This is a documentation
  readability nit only (the note makes the actual current behavior unambiguous), not a functional
  issue, and mirrors how the first implementation note in this same section was also appended
  in place rather than rewriting the base text — consistent with the doc's existing style for
  "Implementation note" corrections, so not asking for a change.
- Required behavior vs. implementation, verified directly against source:
  - V4 type/payload shape matches the design doc's code block exactly, including the
    independent-dimension cross product for `ClaudeHookMetadataOnlyEvent`'s V4 branch
    (`src/shared/eyesOnAgents/claudeHookBridge.type.ts:88-154`).
  - `readClaudeHookEnvironmentAttribution` (`claudeHookBridge.contract.ts:252-259`) never throws,
    reads `CLAUDE_CONFIG_DIR` verbatim, and only captures on non-empty absolute path.
  - Delegation discipline confirmed: only a genuine `SessionStart` bumps `schemaVersion` to 4
    (`claudeHookBridge.contract.ts:270`); every other event delegates straight through V3→V2.
  - `toMetadataOnlyClaudeHookDelivery`/`toMetadataOnlyClaudeHookEvent` carry `claudeConfigDir`
    through unchanged, independently of terminal identity presence
    (`claudeHookBridge.contract.ts:426-443`).
  - `claude_config_dir TEXT` column added with byte-for-byte structural parity to `iterm2_session_id`
    in both the fresh-install `CREATE TABLE` (`eyesOnAgents.table.ts:30-36`) and the idempotent
    migration function (`eyesOnAgents.migration.ts:531-539`), wired into both
    `finalizeCoreSqliteSchema` and `coreSqliteMigrations`
    (`coreSqlite.release.ts:19-20,136-137,222-228`).
  - DAO COALESCE-preserve rule (`eyesOnAgents.dao.ts:2218,2242,2266`) is independent of
    `desktop_session_id`/`iterm2_session_id`, with an explicit code comment calling that out
    (`eyesOnAgents.dao.ts:2216-2217`), and is applied consistently across the SELECT, the no-op
    equality guard, the INSERT bind list, and the UPDATE bind list.
  - `commitClaudeHookDeliveryInternal` passes `claudeConfigDir` correctly
    (`eyesOnAgents.service.ts:3092-3106`).
  - Logging emits only a boolean, never the raw path — confirmed by direct code read
    (`eyesOnAgents.service.ts:3096-3098`) and by a project-wide grep finding no other call site
    that logs `claudeConfigDir`'s value.
- **Scope check (git diff --stat + full-repo grep for `claudeConfigDir`/`CLAUDE_CONFIG_DIR`), no
  out-of-scope files touched.** The uncommitted `git diff --stat` covers exactly 7 files, none of
  them renderer/watcher/plugin-install. A repo-wide grep for `claudeConfigDir`/`ClaudeConfigDir`/
  `claude_config_dir`/`CLAUDE_CONFIG_DIR` turned up several pre-existing, unrelated hits
  (`src/main/eyesOnAgents/claudePath.resolver.ts`, `claudeDirectoryConfig.service.ts`,
  `claudeCommand.runner.ts`, `src/main/xpc/eyesOnAgents.handler.ts`,
  `src/main/claudeSubscription/claudeSubscription.environment.ts`, renderer i18n strings) — these
  all belong to the already-landed tasks 084-086 "which config directory the Claude CLI process
  uses" feature (distinct naming: `resolveAutomaticClaudeConfigDirectory`,
  `requireCanonicalClaudeConfigDirectory`, `pickClaudeConfigDirectory`) and are untouched by 087's
  diff. No renderer `.vue` file, watcher file, or plugin-install file references task 087's new
  symbols (`readClaudeHookEnvironmentAttribution`, `parseEyesOnAgentsClaudeConfigDir`,
  `ensureEyesOnAgentsClaudeConfigDirSchema`, `createClaudeHookEventV4`).
- New test file `claude-hook-environment-attribution.test.mjs` — read in full; 11 tests confirmed,
  each exercising a distinct case from the task's Verification section (valid capture, absent/empty/
  relative rejection, non-SessionStart exclusion, independent both/either/neither combinations,
  parse-time rejection on wrong event/schemaVersion, metadata-only + full JSON round trip, V1/V2/V3
  unchanged, real subprocess end-to-end, and two service-level log/persist assertions). No gaps
  found against the task's stated Verification list.
- The one modified assertion in `claude-hook-terminal-identity.test.mjs`
  (`schemaVersion` `3`→`4` at line ~195) is a narrow, correctly-scoped adaptation: it is the only
  line changed in that file, it is accompanied by an inline comment explaining why, and every other
  assertion in the same test (`terminalApp`, `terminalSessionId`) is left unchanged — this is not a
  weakened assertion, it reflects the real (and correctly widened) subprocess output.
- `repository.test.mjs`'s new `claudeConfigDir` sequence (lines 3459-3524) independently verifies
  set/preserve-on-omit/replace and non-interaction with both `desktop_session_id` and
  `iterm2_session_id` in both directions, matching the claim.
- Code style: new/modified files consistently use `const` arrow functions, `for...of` (no
  `forEach`), and match the surrounding file's formatting and naming conventions (e.g.
  `readClaudeHookEnvironmentAttribution` mirrors `readClaudeHookTerminalIdentity`'s exact shape and
  placement; `parseEyesOnAgentsClaudeConfigDir` mirrors `parseEyesOnAgentsIterm2SessionId`'s exact
  shape and placement). No style deviations found.

## Verification re-run (this review, independently)

All commands below were re-run fresh by this reviewer on the current working tree; all passed with
no failures.

- `node --test scripts/eyes-on-agents/claude-hook-environment-attribution.test.mjs` — 11/11 passed.
- `node --test scripts/eyes-on-agents/claude-hook-terminal-identity.test.mjs` — 9/9 passed.
- `yarn test:eyes-on-agents:bridge` — passed.
- `yarn test:eyes-on-agents:repository` — passed.
- `yarn test:eyes-on-agents:core` — passed.
- `yarn test:eyes-on-agents:claude` — passed; exit code 0; node --test group counts confirmed exactly
  as claimed (27 tests in the `claude-hook-prompt*`/`claude-hook-terminal-identity`/
  `claude-hook-environment-attribution` group, 29 tests in the final
  `claude-provider-toggle*`/`claude-iterm2-open` group), 0 failures anywhere in the chain.
- `yarn typecheck:eyes-on-agents:core` — passed (`tsc -p scripts/eyes-on-agents/tsconfig.strict.json`,
  no errors).
- `node scripts/sqlite-migrations/audit.mjs` — passed (exit code 0).
- Spot-checked the developer's "extra confidence" claim about a pre-existing, unrelated
  `ui-source.test.mjs` failure: confirmed logged in `docs/plan/backlog.md:6-13` and attributed to an
  unrelated upstream merge (`34ba84a`) that removed `app.main.ts`'s bundle-id call — not caused by
  this task.
- Electron/E2E/packaged-app tests were not run, per this review's own instructions and the task's
  explicit scope.

## Conclusion

`pass`
