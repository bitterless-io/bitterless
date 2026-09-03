# Delivery Backlog

Non-blocking review findings are recorded here after task verification.

- **Unrelated to any EyesOnAgents/iTerm2/multi-environment task in this log:** merge commit
  `34ba84a` (2026-09-02, merging in unrelated upstream work) removed `app.main.ts`'s
  `electronApp.setAppUserModelId(...)` bundle-id call without updating
  `scripts/eyes-on-agents/ui-source.test.mjs`'s regex assertion that still expects it, breaking
  `yarn test:eyes-on-agents:ui` (`ERR_ASSERTION` on a `match` operator). Confirmed via `git log`/`git
  show` that this predates and is unrelated to every eyes-on-agents-iterm2-*/claude-multi-env-* task
  — commit 93fc548 (the last of those tasks before the merge) still had the removed code, and no
  task in this log ever touched `app.main.ts` or `ui-source.test.mjs`. Needs a fix on whichever side
  owns that app-bootstrap refactor: either restore the bundle-id call or update the test's
  expectation to match the new startup shape.

- Localize the migrated Maestro renderer's existing English-only product copy after runtime parity is
  accepted. The Bitterless Mini App card is bilingual in the parity delivery.
- Design an explicit, offline migration tool for a closed standalone Cowork profile if preserving
  existing standalone sessions/history becomes a product requirement.
- Make the OnlyPreview native MenuBar hover check deterministic across synthetic pointer injection;
  the product hover state is correct, but one review run missed the injected `mouseMove` before
  succeeding on focused and full reruns.
- Split `tests/coin/specs/trench-omni.spec.ts` before adding another Omni scenario. Task015 Verify
  measured 921 lines, above the `code-review` TS-1 800-line limit; move the reusable Agent Guide and
  viewport helpers into a focused fixture/support module without weakening the real Electron flow.
- Add a lightweight bundled Shell-store behavior harness for OnlyPreview browse/search projection
  races. Current service behavior is covered with real fixtures, while renderer generation,
  refresh, selected-ancestor, and stale-listing guarantees are primarily source-pattern guards.
- Extract Claude plugin identity and artifact generation from
  `claudePluginBridge.service.ts`; task 048 preserved one lifecycle boundary but expanded the
  existing file-size debt from 951 to 1,015 lines.
- Move the task 048 profile-registry/coexistence harness out of `claude-hook.test.mjs`; the focused
  coverage expanded that file from 789 to 931 lines and crossed the 800-line review limit.
- Split `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs` before the next Global Search
  feature adds cases. Task 048's focused opener-dismiss regression is bounded, but the shared test
  file now has 880 lines and exceeds the TS-1 800-line limit.
- Task 081 review: `parseClaudeHookEvent` does not explicitly forbid a hand-crafted
  `schemaVersion: 3` payload for a non-`SessionStart` event with no terminal fields; unreachable from
  the real writer today, but not forbidden by the design doc either. Tighten if a future schema
  change makes this path reachable.
- Task 081 review: `docs/INDEX.md` gained its new-feature-doc registration line outside that task's
  declared `Path` list. No functional impact; note the convention gap rather than treating INDEX.md
  updates as automatically in scope for every task.
- Task 082 review: `eyesOnAgents.contract.ts` now imports `CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN`
  from `claudeHookBridge.contract.ts`, closing a bidirectional value-level ESM cycle between the two
  shared contract files (safe today — both sides use the cross-file binding only inside function
  bodies, confirmed against a real `electron-vite build`). If a third consumer of this pattern ever
  appears, relocate the constant to a dependency-free shared module instead of adding a second cycle
  edge.
- Task 082 review: `coreSqlite.release.ts`'s new `iterm2_session_id` migration wiring falls outside
  `typecheck:eyes-on-agents:core`'s include list; it is covered by the separate
  `typecheck:sqlite-migrations` project, which passed, but the two scoped typecheck projects'
  coverage boundary is worth aligning if this keeps happening across tasks.
- Task 084 review: `ClaudeDirectoryConfigService` retains a dead `getCurrent()` method superseded by
  `listEnvironments()`. Remove it once nothing references it, or confirm it's still an intentional
  compatibility shim and document why.
- Task 084 review: test coverage for `useAutomatic` after `environments[0]` is removed/promoted (the
  "promotion" path) is thin, and persist-failure behavior is only directly tested on 2 of the 7 CRUD
  methods even though all 7 share the same `persist()` chokepoint. Worth a small follow-up test pass
  if this service gets touched again.
- Task 085 review: no test constructs two real Claude environment ids and asserts
  `getClaudeInventoryBridgeEndpoint` produces two distinct socket/named-pipe paths for them — the
  fix is verified correct by diff/grep inspection, but only exercised indirectly through mocked
  watchers. Add a direct two-id endpoint-distinctness test if this function is touched again.
- Task 086 review: a stray blank-line insertion in `src/main/xpc/eyesOnAgents.handler.ts` with no
  functional effect. Cosmetic; fold into the next touch of that file.
- Task 086 review: `claude-environment-plugin-install.test.mjs` never directly exercises the
  `plugin enable` CLI branch (source-level correctness was confirmed independently via a call-site
  scan showing all 16 `this.command()` sites thread `configDirectory`, but no test pins the enable
  branch specifically). Add direct coverage if this area is touched again.
- Task 088 review: `eyesOnAgentsStore.resolveClaudeEnvironmentLabel` compares a thread's
  `claudeConfigDir` — read **verbatim** from the shell env var by
  `readClaudeHookEnvironmentAttribution` (`src/shared/eyesOnAgents/claudeHookBridge.contract.ts`,
  whose comment states "no trim/normalize") — against an environment's `configuredDirectory`, which
  is **realpath-canonicalized** by `requireCanonicalClaudeConfigDirectory`
  (`src/main/eyesOnAgents/claudePath.resolver.ts` → `realpathSync.native`). Only trailing slashes
  are reconciled, so a wrapper exporting `CLAUDE_CONFIG_DIR=/Users/ral/./.claude2`, a case-differing
  path on case-insensitive APFS, or a symlinked path renders no environment label. Consequence is
  confined to a **missing** label, never a wrong one (same-directory duplicates are an explicit
  feature Non-goal), so it stays inside the contract's "no match renders as it does today"
  allowance. Normalize both sides — `path.resolve` plus platform-aware case folding, or canonicalize
  the hook-side value at ingest — if this label ever becomes load-bearing.
- Task 088 review: the plugin setup-action block renders once **per environment row** while its
  content comes from the single global `bridge.value?.setupAction` computed, and the standalone
  card-level setup section still renders too. With two environments and `setupAction: 'enable'` the
  user sees the same "Enable" title plus three identical primary buttons on one screen, differing
  only in click target. The shared *status* is a deliberate consequence of the feature's
  single-installation-identity Non-goal and is documented in
  `docs/features/eyes-on-agents-claude-multi-environment.md`; the visual triplication is not.
  Collapse the repeated block into one card-level surface with a per-environment target selector, or
  drop the standalone section, next time this card is touched.
- **Pre-existing, unrelated to any EyesOnAgents/iTerm2/multi-environment task in this log:**
  `scripts/eyes-on-agents/thread-card-open-capability.test.mjs`'s test "right-click opens the shared
  pointer menu and Archive remains Codex-only" intermittently fails on `assert.ok(dropdown,
  'right-click opens the pointer-aligned shared menu')` (`dropdown` is falsy — `activeContextDropdown()`
  finds no open pointer-aligned menu after the test dispatches a synthetic `contextmenu` `MouseEvent`
  on the thread card). Confirmed pre-existing and unrelated to task 088 (EyesOnAgents Claude
  Multi-Environment Renderer) by reproducing the same failure against a clean
  `git worktree add --detach HEAD` checkout of commit `ebd82eb`, i.e. before any of task 088's changes
  existed. **This is flaky, not deterministic:** 10 standalone `node --test` runs of this one file
  against the clean `ebd82eb` worktree failed 6/10 times (and 7/10 on the task-088 working tree,
  changes unrelated to this file's own logic) — a timing-sensitive race in the real-DOM
  mount/right-click harness, most likely between the synthetic `contextmenu` dispatch and whatever
  microtask/animation-frame timing `activeContextDropdown()`'s underlying Arco trigger popup needs
  to open. `yarn test:eyes-on-agents:ui` therefore intermittently shows 2 pre-existing failures (this
  one and the `ui-source.test.mjs` bundle-id entry above, the latter deterministic) — a run showing
  only the bundle-id failure is not evidence this one was fixed. Needs investigation into the
  underlying timing race, not just a retry/flake-quarantine.

- Task 088 review 2: `resolveClaudeEnvironmentLabel` cannot label a session captured under the
  **automatic** environment's own inherited `CLAUDE_CONFIG_DIR`. It matches only against
  `environment.configuredDirectory`, which is unconditionally `null` for the single
  `mode: 'automatic'` environment (`claudeObservation.service.ts`'s status builder returns the
  configured directory only when `mode === 'custom'`). So if Bitterless's own GUI process ambiently
  inherits a real `CLAUDE_CONFIG_DIR` — making the automatic environment's effective directory a
  real non-`~/.claude` path — a session started under that same ambient var never gets a label, even
  in a two-environment setup. Consistent with the design doc's own field semantics
  (`configDirectory` is defined as `null` when `mode` is `'automatic'`) and outside every Acceptance
  bullet, so informational. Pairs with the path-normalization entry above: both are reasons the
  environment label can come back empty. Give the automatic environment a resolvable effective
  directory for matching purposes if the label ever becomes load-bearing.
- Pre-existing, unrelated to the iTerm2 Open feature: `yarn check:renderer-i18n` crashes on
  `assert(trayCreateIndex > homeCreateIndex, 'Tray must follow Home creation')`
  (`scripts/renderer-i18n/check-renderer-i18n.mjs:186`) because commit `c67ac21` changed
  `trayHelper.init(mainWindowHelper)` to `trayHelper.init({ ... })` in `src/main/app.main.ts` without
  updating the check script's literal-substring probe. The script never reaches any i18n-content
  assertion while this is broken. Fix the probe (or the assertion it feeds) so the i18n check is
  load-bearing again.
