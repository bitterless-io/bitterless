# Review: EyesOnAgents Claude Multi-Environment Renderer (task 088)

Reviewed source: `git diff ebd82eb 53a989d` (task 088's isolated contribution, per the orchestrator's
instructions — `53a989d` is a generic sync commit that happens to also carry this task's finished
code). Working tree is clean at review start and end; no source was edited; Electron/E2E was not run.
All commands below were re-run independently by this review, not copied from the task file.

## Findings

### P1 — `EyesOnAgentsApi`/`EyesOnAgentsService` resolution: independently confirmed sound (non-blocking)

This is the safety-critical part of the task and received the deepest scrutiny.

- **`yarn typecheck:eyes-on-agents:core` re-run: 0 errors**, confirming `EyesOnAgentsService implements
  EyesOnAgentsApi` still type-checks after the interface was widened by 11 members/signatures (7 new
  CRUD + 4 widened bridge methods + `retryClaudeDirectory`).
- **Why it type-checks, traced member by member** (`git diff ebd82eb 53a989d -- src/shared/eyesOnAgents/eyesOnAgents.type.ts src/main/eyesOnAgents/eyesOnAgents.service.ts`):
  - The 7 new CRUD methods (`listClaudeEnvironments`, `addClaudeEnvironment`, `renameClaudeEnvironment`,
    `removeClaudeEnvironment`, `setClaudeEnvironmentEnabled`, `chooseClaudeEnvironmentDirectory`,
    `useAutomaticClaudeEnvironment`) have **byte-identical parameter/return shapes** between the
    interface and the service's new delegate implementations (`eyesOnAgents.type.ts:250-264` vs.
    `eyesOnAgents.service.ts:129-184`) — not a bivariant/looser match, an exact one.
  - `installClaudeBridge`, `refreshClaudeBridgeStatus`, `removeClaudeBridge`, and `retryClaudeDirectory`
    are also exact matches: interface and service both declare `params?: { environmentId?: string }`
    (`eyesOnAgents.type.ts:235-249`, `eyesOnAgents.service.ts:2871,2918,2975,3135`).
  - `getClaudeBridgeStatus` is the one case relying on ordinary TS method-parameter compatibility
    rather than an exact match: the interface widened to `params?: { environmentId?: string }`
    (`eyesOnAgents.type.ts:238-240`) but `EyesOnAgentsService.getClaudeBridgeStatus` was deliberately
    **not** touched — it stays `async getClaudeBridgeStatus(): Promise<EyesOnAgentsClaudeBridgeStatus>`
    (`eyesOnAgents.service.ts:2993`). This is valid because a method with fewer (here, zero) formal
    parameters is always assignable to an interface member declared with more optional ones — every
    caller of the wider signature can still call the narrower one. Confirmed this is not just
    type-theoretically sound but inert in practice: `EyesOnAgentsHandler.getClaudeBridgeStatus`
    (`eyesOnAgents.handler.ts:460-473`) still calls `eyesOnAgentsService.getClaudeBridgeStatus()` with
    zero arguments — the handler resolves/validates the environment id itself (so an unknown id still
    rejects, satisfying "clear rejected error, not silent fallback") but never forwards it into the
    service, exactly matching task 086's documented "pure status read, nothing to scope" rationale.
- **No XPC/renderer call path reaches the 7 service-level CRUD delegates (confirmed by exhaustive grep,
  not by trusting the claim):** `grep -rn "eyesOnAgentsService\.<method>"` across `src/main` for all 7
  method names returns zero hits outside `eyesOnAgents.service.ts` itself. Reading
  `EyesOnAgentsHandler`'s real XPC-registered implementations (`eyesOnAgents.handler.ts:508-560`)
  confirms each calls the module-scope `claudeDirectoryConfig` singleton directly (e.g.
  `claudeDirectoryConfig.listEnvironments()`, `claudeDirectoryConfig.addEnvironment(...)`) — the exact
  same singleton injected into `EyesOnAgentsService`'s constructor, but never routed through the
  service's own copies. The service-level methods exist solely to satisfy `implements EyesOnAgentsApi`.
- **Fallback-to-ambient-behavior, verified against the oldest pre-088 test harness, not a new one:**
  `scripts/eyes-on-agents/claude-provider-toggle.test.mjs` (from commits `2221a75`/`804d941`, predating
  every task in this 5-task plan) constructs `EyesOnAgentsService` with **no** `claudeDirectoryConfig`
  or `pickClaudeConfigDirectory` key at all (`claude-provider-toggle.test.mjs:292-314`) and calls
  `installClaudeBridge()`, `refreshClaudeBridgeStatus()`, `removeClaudeBridge()`,
  `getClaudeBridgeStatus()`, and `retryClaudeDirectory()` with zero arguments
  (`claude-provider-toggle.test.mjs:632,724,741-747`). Re-ran this file directly:
  **14/14 tests pass** on current HEAD. This confirms `resolveClaudeBridgeConfigDirectory` and
  `resolveClaudeDirectoryRetryEnvironmentId` (`eyesOnAgents.service.ts:3009-3020,3134-3140`) correctly
  return `undefined` when the dependency was never injected, reproducing every pre-088 zero-arg
  caller's exact ambient behavior rather than throwing.
- **`retryClaudeDirectory`'s environment targeting genuinely hits one specific environment, not all or
  always-default:** traced the full chain — renderer `retryClaudeDirectoryForEnvironment(id)`
  (`eyesOnAgents.store.ts:433-437`) → emitter `retryClaudeDirectory({ environmentId: id })` → handler
  `resolveClaudeBridgeEnvironment(...)` (throws on an unknown id, `eyesOnAgents.handler.ts:494-501`) →
  service `resolveClaudeDirectoryRetryEnvironmentId` → `claudeObservation.retryDirectory(environmentId)`
  (`claudeObservation.service.ts:220-231`) → `retryEnvironmentEntry(environmentId ??
  resolveDefaultEnvironmentId())` → `this.environments.get(id)` (`claudeObservation.service.ts:647-649`),
  a real `Map<environmentId, ClaudeEnvironmentObservationState>` keyed lookup. An id that isn't in the
  map returns immediately (`if (!state) return;`) rather than falling through to any other environment.
  This is task 085's pre-existing per-environment retry-timer plumbing, reused unchanged — 088 only
  added a public path to target it explicitly.

**Conclusion for Priority Investigation 1: sound.** All 11 widened/added interface members are either
exact signature matches or a documented, verified-inert use of standard TS method-parameter
compatibility. No renderer/XPC path reaches the decoy service-level CRUD methods. The zero-dependency
fallback behavior is proven against the oldest relevant test file in the codebase, not a
task-088-authored one.

### P2 — Flakiness finding (Gap 2) and its backlog entry: corroborated (non-blocking)

- `docs/plan/backlog.md:71-87`'s entry accurately describes what was found: pre-existing (reproduces on
  `ebd82eb`, before task 088 existed), unrelated to task 088's own logic, and explicitly characterized
  as **flaky, not deterministic** with `6/10` (clean `ebd82eb`) and `7/10` (088 working tree) figures.
  Nothing in the entry overstates or understates the finding.
- **Independent reproduction (with one methodology correction worth recording):** an initial
  `git worktree add --detach <path> ebd82eb` run produced `Error [ERR_MODULE_NOT_FOUND]:
  Cannot find package 'esbuild'` on every run — `git worktree add` does not carry `node_modules` into
  the new worktree, so all ~28 "failures" from that first attempt were invalid (not the real
  right-click assertion) and were discarded. Redone correctly by symlinking `node_modules` from the
  main checkout into the worktree (safe — `git diff ebd82eb 53a989d -- package.json yarn.lock` shows no
  dependency changes, only a `test:eyes-on-agents:ui` script-list addition):
  - **Current HEAD (`53a989d`), 15 runs:** 11 failed / 4 passed (73% fail rate). Every failure was the
    identical `assert.ok(dropdown, 'right-click opens the pointer-aligned shared menu')` in "right-click
    opens the shared pointer menu and Archive remains Codex-only" — never a different test.
  - **`ebd82eb` (pre-088), 15 runs, valid this time:** 10 failed / 5 passed (67% fail rate), same
    single assertion. Confirmed via `git diff ebd82eb 53a989d -- scripts/eyes-on-agents/thread-card-open-capability.test.mjs`
    that this specific test's own code is byte-identical between the two commits (the file's other
    changes are unrelated additions/fixture updates), so the two fail-rate samples are apples-to-apples.
  - Both samples corroborate the backlog's three core claims (pre-existing, unrelated to 088, genuinely
    non-deterministic — real passes were observed on both commits). My own rates (67%/73%) trend
    somewhat higher than the recorded 60%/70%, which is expected/unremarkable for a timing-sensitive
    real-DOM race sampled on a different machine at a different time — not evidence the backlog entry
    is wrong, since a "flaky" characterization does not claim a stable percentage.
- `yarn test:eyes-on-agents:ui` re-run 3 times: **98 tests, 96 pass / 2 fail every time**, and the 2
  failures were, in every run, exactly the two already-known pre-existing ones (the `ui-source.test.mjs`
  bundle-id assertion, deterministic, and this right-click assertion) — never a third.

### P3 — Completion-pass gap 1 (restored per-environment metadata/Retry): confirmed genuine, not cosmetic

- `ClaudeObservationCard.vue`'s per-row template (lines 139-146) renders
  `environmentDesktopLabel(environment)`, `environmentLastScanLabel(environment)`, and (conditionally)
  `environmentNextRetryLabel(environment)`, each reading real per-row fields
  (`environment.desktopDirectoryCount`, `.lastSuccessfulScanAt`, `.nextRetryAt` — lines 532-543) off the
  real `EyesOnAgentsClaudeEnvironmentStatus[]` snapshot array, not placeholder/static text.
- `canRetryEnvironment` (`ClaudeObservationCard.vue:544-547`) is **byte-for-byte identical** to the
  pre-088 `canRetryDirectory` computed (confirmed via `git show ebd82eb:.../ClaudeObservationCard.vue`
  lines 410-413): `providerError.value !== null || ['waiting', 'degraded', 'retrying', 'error']
  .includes(...)`. Cross-checked against the state-to-UI mapping table in
  `docs/integrations/eyes-on-agents-layout.md:341-354` (the actual per-state Retry-affordance table in
  this codebase; `docs/features/eyes-on-agents-claude-observation.md` itself contains no such table,
  only the bare `state:` TS union — a minor imprecision in how Priority Investigation 3's brief named
  the source document, not a code issue) — the table's `waiting`/`degraded`/`retrying`/`error`
  rows and its "Claude provider error → Retry on every row" row match the shipped condition exactly.

### P3 — Completion-pass gap 3 (layout doc update): confirmed accurate, not idealized

`docs/integrations/eyes-on-agents-layout.md`'s rewritten "Claude environments" section
(lines 291-354) and thread-card tooltip paragraph (lines 414-421) were cross-checked claim-by-claim
against the real `ClaudeObservationCard.vue`/`ThreadCard.vue` template and computeds:

- Add-environment header button + inline label form, inline Rename/Save/Cancel, bordered read-only
  path input, mode/state text, row-scoped Change directory, default-row-only Use automatic
  (`isEligibleForAutomatic`, line 524-526), enable/disable switch, Remove disabled with a hint for the
  last remaining row, desktop-count/last-scan/next-retry metadata, and the Retry button's exact
  recoverable-state condition all match the shipped code precisely — including the ASCII diagram's
  layout and the state table's per-state Retry availability.
- The tooltip paragraph's `{label} · Working directory: {path}` format, live (non-persisted)
  resolution, and "renamed environment updates immediately / removed environment silently loses the
  prefix" contract match `ThreadCard.vue`'s `environmentLabel`/`folderLabel` computeds and
  `i18nHelper.eyesOnAgents.thread.workingDirectoryWithEnvironment` exactly.

### P3 — Minor, non-blocking observations (informational, not defects)

1. **"Surface the last-environment constraint from the service" was not literally followed, but there
   is nothing to surface.** The Required-behavior bullet asks that Remove's last-remaining-environment
   disablement be "surface[d]... from task 084's service rather than re-deriving it in the renderer,"
   but no task from 084 onward ever added a `canRemove`/`isLast` field to
   `EyesOnAgentsClaudeEnvironment`/`EyesOnAgentsClaudeEnvironmentStatus`. `environmentRows.length <= 1`
   (`ClaudeObservationCard.vue:186-190`) is the only feasible client-side derivation available, and it
   cannot drift from the service's own `removeEnvironment` guard since both read the same
   `listEnvironments()`-sourced array's length. No functional risk; worth a one-line note in
   `docs/plan/backlog.md` only if this area is touched again.
2. **`resolveClaudeEnvironmentLabel` cannot label a session captured under the automatic environment's
   own inherited `CLAUDE_CONFIG_DIR`.** It matches only against `environment.configuredDirectory`
   (`eyesOnAgents.store.ts:460-467`), which is unconditionally `null` for the one `mode: 'automatic'`
   environment (`claudeObservation.service.ts`'s status builder: `configuredDirectory: state.config.mode
   === 'custom' ? state.config.configDirectory : null`). In the unusual case where Bitterless's own GUI
   process ambiently inherits a real `CLAUDE_CONFIG_DIR` (making the "automatic" environment's effective
   directory a real, non-`~/.claude` path), a session under that same ambient var would never receive a
   label, even in a two-environment setup. This is consistent with the design doc's own field semantics
   (`EyesOnAgentsClaudeEnvironment.configDirectory` is defined as `null when mode is 'automatic'`), not
   a renderer bug, and is outside every explicit Acceptance bullet (which only require labeling a
   *second*/custom environment's sessions). Informational only.

## Standard checks

### Required behavior compliance

- Environment list CRUD, guidance note, thread-card tooltip label: all present and wired as specified
  (see findings above and the Implementation evidence, independently re-verified rather than trusted).
- **`canOpenThread`/`openLabel`/`canOpenInIterm2` byte-for-byte unchanged:**
  `git diff ebd82eb 53a989d -- .../ThreadCard.vue` is a single hunk touching only the `folderLabel`
  computed (adding a new `environmentLabel` computed above it) — `grep -c
  'canOpenThread\|openLabel\|canOpenInIterm2'` over that diff returns `0`, confirmed independently.

### Test meaningfulness and coverage

- `scripts/eyes-on-agents/claude-environment-render.test.mjs`: re-ran directly, **12/12 pass**. Test
  names (one row per environment; "Not configured"; Add/Rename/enable-switch/Remove call the correct
  store method with the correct payload; Remove disabled for the last environment; Change
  directory/Use automatic scoped to the clicked row; the empty-id sentinel recovers via legacy zero-arg
  methods; desktop/last-scan/next-retry text; Retry offered only in a recoverable state and scoped to
  the clicked row; a global provider error offers Retry even on a healthy row) map onto every bullet in
  the task's Verification section plus the completion pass's 3 additional scenarios. This is a real-DOM
  mount/click harness, not source-pattern matching — meaningful coverage, not a rubber stamp.
- `scripts/eyes-on-agents/ui-source.test.mjs`'s updated assertions for the new shape
  (`environmentPath(environment)`, `isEligibleForAutomatic`, `canRetryEnvironment(environment)`,
  `retryClaudeDirectoryForEnvironment(id)`, etc.) were spot-checked against the real file content and
  match verbatim — not stale patterns left over from the pre-088 shape.
- The new "folder tooltip gains the resolved environment label" test in
  `thread-card-open-capability.test.mjs` and every pre-existing test in that file (iTerm2 Open,
  081-083) pass unmodified (see flakiness section above for the one unrelated, pre-existing exception).

### Commands re-run independently, exact results

| Command | Result |
|---|---|
| `yarn typecheck:eyes-on-agents:core` | 0 errors |
| `yarn typecheck:eyes-on-agents:ui` | 0 errors |
| `yarn test:eyes-on-agents:ui` (×3 runs) | 98 tests; **96 pass / 2 fail** every run — always exactly the 2 known pre-existing failures (`ui-source.test.mjs` bundle-id assertion, deterministic; the right-click/dropdown flake, present in all 3 of these particular runs), never a third |
| `yarn test:eyes-on-agents:claude` | 29 tests in the final `node --test` group, **29/29 pass**; full `&&`-chained script (including `claude-directory-config`, `claude-environment-config`, `claude-environment-watcher`, `claude-environment-plugin-install`, `claude-hook-environment-attribution`) reached the end, confirming every earlier step also exited 0 |
| `yarn test:eyes-on-agents:core` | pass |
| `yarn test:eyes-on-agents:repository` | pass |
| `yarn test:eyes-on-agents:bridge` | pass (run defensively, not explicitly required by this task, since it's named in the feature doc's Acceptance section) |
| `node scripts/sqlite-migrations/audit.mjs` | pass (14 Core + 7 Maestro + 10 Todoist sync + 8 Trench baselines) |
| `yarn check:renderer-i18n` | fails identically at the pre-existing, unrelated `Tray must follow Home creation` assertion (`check-renderer-i18n.mjs:172`), matching `docs/plan/backlog.md`'s documented defect — never reaches an i18n-content assertion, consistent with the task's explicit note not to expect this to pass |
| `git diff --check` | clean, exit 0 |
| Production build (`yarn build`) | **not run** — it invokes `runWithRuntimeProfile.cjs debug_dev`, which risks launching Electron; out of scope per this review's explicit instruction. `vue-tsc`/`tsc` typecheck across the same file set already validates compile-time correctness. |
| Owner-only two-real-environment manual verification | not run, as instructed |

i18n key parity independently re-checked (not just trusted): `en.ts`/`zh.ts`'s `claudeEnvironment`
blocks have identical key sets in identical order (`title/guidance/addEnvironment/addLabelPlaceholder/
add/notConfigured/rename/renameLabelPlaceholder/save/cancel/changeDirectory/useAutomatic/enable/
disable/remove/removeLastHint`), and `thread.workingDirectoryWithEnvironment` exists in both files.
`zh.ts`'s `export const zh: typeof en` module-level assertion (confirmed present at
`zh.ts:5`) makes the clean `typecheck:eyes-on-agents:ui` result a structural proof of parity, not just
a spot-check.

### Code style consistency

- Arrow consts throughout the new code (no `function` declarations introduced); class methods keep
  method shorthand; semicolons present; camelCase/two-dot-suffix new file names N/A (no new files added
  by 088 beyond test files, which follow the established `*.test.mjs` convention).
- `git diff ebd82eb 53a989d` over the three touched TS/Vue files shows no `forEach` usage introduced.
- `ConnectionPanel.less`'s new rules (`gap: 7px`/`8px`, `oklch(1 0 0 / 55%)` background) are consistent
  with this same file's pre-existing, already-mixed gap values (2/3/4/6/7/8/10/12/16px appear
  throughout the file already) and its established `oklch()` color convention — not a deviation from
  local style.

## Acceptance-criteria satisfaction table

(`docs/features/eyes-on-agents-claude-multi-environment.md`'s "Acceptance" section, one bullet at a
time, excluding the explicitly owner-only manual two-environment check.)

| # | Bullet | Satisfied? | Evidence |
|---|---|---|---|
| 1 | Fresh install / persisted `schemaVersion: 1` both hydrate to exactly one automatic, enabled, default environment | Yes | Task 084's `claudeDirectoryConfig.service.ts` hydrate/migration logic, covered by `claude-directory-config.test.mjs` (migration/fresh-install cases) — part of the `test:eyes-on-agents:claude` chain, re-run and confirmed reaching its end (exit 0) in this review |
| 2 | Adding a second environment starts its own independent watcher; retry/error state never crosses environments | Yes | Task 085's map-based `ClaudeObservationService` (`Map<environmentId, ...>`), covered by `claude-environment-watcher.test.mjs` (independent-lifecycle scenarios) — re-run as part of the passing `test:eyes-on-agents:claude` chain; independently re-traced `retryEnvironmentEntry`'s `this.environments.get(id)` keying in this review (Priority Investigation 1) |
| 3 | Installing the hook for a second environment runs `claude` with that environment's `CLAUDE_CONFIG_DIR`, without altering the default environment | Yes | Task 086's `configDirectory` threading through `claudeCommand.runner.ts`/`claudePluginBridge.service.ts`, covered by `claude-environment-plugin-install.test.mjs` (still passing, unmodified by 088); task 088 completes the end-to-end reachability by giving the renderer per-row `installClaudeBridgeForEnvironment(id)` → `{ environmentId }`, traced in this review |
| 4 | A session started under that `CLAUDE_CONFIG_DIR` is discovered and/or Hook-observed exactly like the default environment's, including the already-shipped iTerm2 Open path | Yes | Tasks 085 (watcher discovery)/087 (Hook capture); `claude-iterm2-open.test.mjs` and every pre-existing `ThreadCard.vue` Open-capability test pass unmodified (confirmed: `canOpenThread`/`openLabel`/`canOpenInIterm2` untouched by 088's diff) |
| 5 | The session's thread row records `claude_config_dir` matching the second environment's directory; the renderer resolves and displays that label without a persisted foreign key | Yes | Task 087 persists `claude_config_dir` (087, `repository.test.mjs`); task 088's `eyesOnAgentsStore.resolveClaudeEnvironmentLabel` (read-time match against the live snapshot, no FK) + `ThreadCard.vue`'s `environmentLabel`/`folderLabel` computeds; new passing test "the folder tooltip gains the resolved environment label only when a match exists" |
| 6 | Removing an environment stops only its watcher and removes it from the list; does not retroactively clear `claude_config_dir` on persisted rows; a thread whose environment was removed simply loses its label | Yes | `removeEnvironment` (084) only mutates the environment list — no code path in 084-088 ever writes `claude_config_dir`; `resolveClaudeEnvironmentLabel`'s `.find(...)` naturally returns `null`/no match once an environment is gone, silently dropping the label (by construction, not a special case) |
| 7 | The last remaining environment cannot be removed | Yes | `removeEnvironment` throws (084, tested); renderer disables Remove with a hint when `environmentRows.length <= 1` — test "Remove is disabled for the last remaining environment" passes |
| 8 | No `configDirectory` value is ever written to `main.log`; lifecycle/watcher/plugin/Hook-attribution log lines identify only by `id`/`label` | Yes | 088's diff introduces **zero** new logging call sites (confirmed by reading the full diff) — nothing new to leak; existing loggers from 084-086 already established and tested to exclude `configDirectory` |
| 9 | Repository, migration audit, core, bridge, UI-source, typecheck, and production build checks run without launching Electron windows | Yes, with one caveat | Repository/core/bridge/migration-audit/typecheck(core+ui)/UI-source all re-run in this review, none launched Electron; production build (`yarn build`) was **not run** in this review pass since it risks launching Electron per this review's own scope constraint — typecheck across the same file set already validates compile-time correctness, so this is a scope-limited "not run" rather than a failure |
| — | Manual two-real-environment verification | N/A (owner-only) | Correctly not attempted, as instructed |

## Conclusion

`pass`
