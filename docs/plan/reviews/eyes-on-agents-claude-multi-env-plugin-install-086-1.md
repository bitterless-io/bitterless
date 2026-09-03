# Review: EyesOnAgents Claude Multi-Environment Plugin Install (task 086)

Reviewed source: `git diff 93fc548 fcd675f` (task 086's own changes, isolated from the unrelated
`34ba84a` merge) plus the resulting shape on current HEAD (`780bf49`). Working tree is clean; no
source was edited, no Electron/E2E was run during this review.

## Findings

### P1 — Core `CLAUDE_CONFIG_DIR` assumption: independently corroborated (non-blocking)

Verified both legs of the developer's evidence and added a third, independent one:

- **Documentation**: fetched all three `code.claude.com/docs` pages myself
  (`/docs/en/claude-directory`, `/docs/en/settings`, `/docs/en/plugins-reference`) and confirmed
  every quoted sentence in the task file (lines 94–104) is accurate and in context, including the
  `~/.claude/plugins` file-tree row text and the `--scope user` → `~/.claude/settings.json` mapping
  in the plugin-scope table.
- **My own empirical probe** (disposable dir/marketplace/plugin names different from the
  developer's, under this session's own scratchpad, deleted after use): `claude plugin marketplace
  add --scope user` + `claude plugin install ... --scope user` (matching the exact `--scope user`
  flag `claudePluginBridge.service.ts` actually uses — confirmed by grep) wrote exclusively under
  my isolated `CLAUDE_CONFIG_DIR`. I checked absence in **two** distinct ambient contexts: this
  sandbox's own ambient `CLAUDE_CONFIG_DIR` (`~/.claude2`, a harness-level isolation unrelated to
  Bitterless) and, separately, the **true real** `~/.claude` (via `env -u CLAUDE_CONFIG_DIR`) —
  neither showed the probe marketplace/plugin before or after. Post-cleanup `grep -ril` over both
  directories was clean (the one hit in `~/.claude2` was this session's own transcript file quoting
  my bash commands, not marketplace/plugin state). As a side effect this also confirms the real
  production `bitterless-observer@bitterless-local` plugin is correctly registered under the real
  `~/.claude` today, untouched by anything in this review.
- **Conclusion**: the core assumption fully holds, with the exact scope (`--scope user`) the real
  implementation uses. No gap found between what was probed and what `claudePluginBridge.service.ts`
  actually invokes.

### P2 — Installation-identity state machine: confirmed untouched (non-blocking)

- `git diff 93fc548 fcd675f -- src/main/eyesOnAgents/claudePluginBridge.service.ts`: every hunk is
  parameter-threading only. Independently re-verified with a bracket-matching scan of every
  `this.command(executable, [...])` call site (16 total, e.g.
  `src/main/eyesOnAgents/claudePluginBridge.service.ts:454-455,566,570,664,668,673,680,683,694,758,770,1310,1332,1359-1360`)
  — all 16 now pass `configDirectory` as the third argument; none were missed.
- The four pre-existing plugin-bridge test files (`claude-update-continuity.test.mjs`,
  `claude-setup-recovery.test.mjs`, `claude-hook.test.mjs`,
  `claude-legacy-marketplace-recovery.test.mjs`) have **zero diff** between 93fc548 and fcd675f —
  stronger than "no assertion changes," these files are byte-identical. Re-ran all four myself on
  current HEAD: 5/5, clean pass, clean pass, 6/6 — all exit 0.
- `resolveExecutable()`'s two capability-probe commands (`plugin --help`,
  `src/main/eyesOnAgents/claudePluginBridge.service.ts:1466`; `plugin marketplace remove --help`,
  line 1472) call `this.runCommand` directly with no `configDirectory` — confirmed unscoped as
  claimed. This is correct/safe: CLI `--help` capability text is a static property of the resolved
  binary, not of any `CLAUDE_CONFIG_DIR`'s contents, and the resolved executable is cached once per
  service instance (`this.executable`, shared across every environment within one Bitterless
  profile) regardless of which environment triggered the probe.

### P3 — Out-of-Path changes: minimal and correctly scoped, with one real planning gap surfaced for task 088 (non-blocking for 086)

- `src/main/eyesOnAgents/eyesOnAgents.service.ts` diff (`93fc548..fcd675f`) is exactly as claimed:
  the `claudeBridge` dependency's `install`/`refresh`/`remove` gain one optional
  `configDirectory?: string` each (lines 116–118), and the three matching service methods thread it
  straight through (lines 2857, 2894, 2954) with no other line touched.
- `src/main/eyesOnAgents/claudeBridgeEnvironment.resolver.ts` and
  `src/main/eyesOnAgents/claudeBridgeLog.helper.ts` are both pure and Electron-free (no
  `electron`/`app` imports). Traced the handler call sequence
  (`src/main/xpc/eyesOnAgents.handler.ts:397-465`): `resolveClaudeBridgeEnvironment(...)` is the
  first statement in all four bridge methods, executed **before** any call into
  `eyesOnAgentsService`/the CLI layer — an unknown id throws synchronously there, so no CLI spawn is
  ever attempted, exactly as required. `logClaudeBridgeAction` (`claudeBridgeLog.helper.ts:16-25`)
  logs only `action`/`id`/`label`/a 300-char-bounded sanitized error string; `configDirectory`, raw
  CLI output, and the executable path never appear anywhere in it — confirmed by reading the
  function body, not just the test assertions.
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (`EyesOnAgentsApi`): `git diff 93fc548 fcd675f`
  produces **zero output** — confirmed genuinely untouched.
- **Task 088 gap (P2, non-blocking for 086, actionable before 088 starts):** task 088's current file
  (`docs/plan/tasks/eyes-on-agents-claude-multi-env-renderer-088.md:34-55`) does correctly name both
  dangling pieces — task 084's 7 CRUD methods and task 086's 4 bridge methods
  (`installClaudeBridge`/`getClaudeBridgeStatus`/`refreshClaudeBridgeStatus`/`removeClaudeBridge`)
  — as needing `EyesOnAgentsApi` extension. However, as literally scoped it is internally
  inconsistent: widening `EyesOnAgentsApi`'s 4 bridge methods to `params?: { environmentId?: string
  }` (required by line 53's "Update those 4 signatures") requires `EyesOnAgentsService` (which also
  `implements EyesOnAgentsApi`) to accept a structurally compatible parameter — but its existing
  bridge methods take `configDirectory?: string`
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:116-118`, and the concrete methods at/around lines
  2793, 2839, 2893), which is not assignable to/from `{ environmentId?: string }` in either
  direction (this is precisely the `TS2416` failure task 086 documented hitting and deliberately
  avoided — see task 086's Deviation #2). Task 088's own Path
  (`eyes-on-agents-claude-multi-env-renderer-088.md:89-90`) restricts
  `src/main/eyesOnAgents/eyesOnAgents.service.ts` edits to "thin delegating implementations of those
  7 interface members only — do not touch any other existing method in this file," which forbids
  the very change (updating the 4 pre-existing bridge methods' own parameter shape, or otherwise
  reconciling the mismatch) needed to satisfy its own Required-behavior bullet without a fresh
  compile error. This is a genuine unresolved design question for whoever picks up task 088, not a
  defect in task 086's own diff — flagging so it is not rediscovered the hard way mid-088.

### P3 — Minor: unrelated blank-line insertion (non-blocking)

`src/main/xpc/eyesOnAgents.handler.ts:209` adds one blank line before the pre-existing "One
ClaudeWatcherSupervisor per configured Claude environment" comment block, outside task 086's
declared scope. Purely cosmetic whitespace, not worth reverting, noted only for completeness against
the "surgical changes" house rule.

### P3 — Minor: `plugin enable` CLI call not exercised with `configDirectory` scoping by the new test (non-blocking)

`scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs`'s `createPluginHarness` always
defaults `installEnabled: true` (line 48), so every scenario's mocked `plugin install` immediately
reports the plugin as enabled and the service's `plugin enable` branch
(`src/main/eyesOnAgents/claudePluginBridge.service.ts:693-695`) is never actually invoked by any of
the file's 8 scenarios. The per-call scoping assertions (scenario 2) therefore never directly
observe an `enable` command's `configDirectory`. Source-level correctness is still established
independently — the bracket-matching scan above confirms line 694's `this.command(...)` call
receives `configDirectory` identically to every sibling call site — so this is a test-coverage gap,
not a functional defect.

### Standard checks

- **Required behavior match**: exact. `claudeCommand.runner.ts`'s options gain one optional field
  (line 15); omitted/`null` reproduces `process.env` unchanged (verified by a real child-process
  spawn test comparing against this session's own live `CLAUDE_CONFIG_DIR`, and independently by my
  own probe). The four XPC methods gain `{ environmentId }`, resolve via task 084's
  `listEnvironments()`, and reject an unknown id before any CLI spawn (traced above). The
  automatic-environment no-op case is covered by a real, passing test (scenario 3 in the new test
  file) — re-ran it myself.
- **Test coverage vs. task file's Verification section**: all three bullets covered (non-default
  environment scoping + isolation between two live harnesses; automatic-environment no-op; unknown
  id rejects with zero CLI spawn), modulo the `plugin enable`-scoping gap noted above.
- **Commands re-run on current HEAD, real exit codes:**
  - `node scripts/eyes-on-agents/claude-environment-plugin-install.test.mjs` → exit 0, "EyesOnAgents
    Claude environment plugin install tests passed"
  - `node scripts/eyes-on-agents/claude-update-continuity.test.mjs` → exit 0, 5/5
  - `node scripts/eyes-on-agents/claude-setup-recovery.test.mjs` → exit 0
  - `node scripts/eyes-on-agents/claude-hook.test.mjs` → exit 0
  - `node --test scripts/eyes-on-agents/claude-legacy-marketplace-recovery.test.mjs` → exit 0, 6/6
  - `yarn test:eyes-on-agents:claude` → exit 0, ends at 29/29 (`claude-legacy-marketplace-recovery`
    + `claude-hook-admission` + `claude-update-continuity` combined `node --test` group), zero
    failures anywhere in the group
  - `yarn test:eyes-on-agents` (full) → **exit 1**, but the only failure is the already-known,
    already-logged (`docs/plan/backlog.md`), unrelated `ui-source.test.mjs` bundle-id assertion
    (`ui` group: 85 tests, 84 pass, 1 fail) caused by the upstream `app.main.ts` refactor from the
    `34ba84a` merge — every group through `test:eyes-on-agents:claude` (core, project-resolver,
    repository, app-server, bridge, claude) passed with 0 failures. Not attributable to task 086.
  - `yarn typecheck:eyes-on-agents:core` → exit 0, 0 errors
  - `yarn typecheck:eyes-on-agents:ui` → exit 0, 0 errors
- **Code style**: consistent with the bitterless house style — new files use arrow consts
  (`claudeBridgeEnvironment.resolver.ts`, `claudeBridgeLog.helper.ts`), camelCase + two-dot-suffix
  file names (`.resolver.ts`, `.helper.ts`), semicolons throughout, an injectable `logger` default
  parameter matching `claudeDirectoryConfig.service.ts`'s established DI convention, and the
  `resolveClaudeBridgeEnvironment` error string (`'Claude environment was not found'`) matches
  `claudeDirectoryConfig.service.ts`'s existing identical error text verbatim (confirmed by grep,
  appears there 5 times). No `forEach` usage introduced.

## Conclusion

`pass`
