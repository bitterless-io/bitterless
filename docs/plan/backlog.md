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
- **Task 089 review: the function-name derivation rules can silently collide, and pasting
  both wrappers makes one environment unreachable.** `[^a-z0-9_]+ → _` plus run-collapsing is
  many-to-one: verified with the real
  `deriveEyesOnAgentsClaudeEnvironmentFunctionName` that `Claude Work`, `claude-work`,
  `claude_work`, and `Claude/Work` all derive to `claude_work`; likewise `claude 2` and `claude-2`
  both derive to `claude_2`. Two environments with such labels produce two wrappers with the same
  function name, and a user who pastes both into `.zshrc` silently keeps only the second — the first
  environment's `CLAUDE_CONFIG_DIR` becomes unreachable with no error anywhere. The feature doc's
  Non-goals cover duplicate *directories*
  (`docs/features/eyes-on-agents-claude-multi-environment.md:524-526`) but say nothing about
  duplicate derived function names. Not blocking and arguably a user configuration error like the
  duplicate-directory case, but unlike that case there is no UI hint at all. Consider surfacing the
  derived name in the button tooltip or the guidance note so a collision is visible before the paste,
  or disambiguating with a suffix.
- **Task 089 review: the per-row `Copied` confirmation never resets, so it can advertise a
  stale clipboard.** `setupCommandCopiedId`
  (`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue:516`) is set
  at `:666` and cleared only on failure (`:668`) or when another row is copied. There is no
  resetting `watch` — the card's only `watch` is the pre-existing `setupAction` one at `:469`, which
  resets the card-level `reloadCommandCopied` but not this ref. So after copying row X, using
  **Change directory** or **Rename** on that same row leaves its button reading `Copied` while the
  clipboard still holds the wrapper for the *old* directory/label. The button remains clickable and
  a second click does copy the fresh snippet, so the harm is confined to a misleading label. Add
  `setupCommandCopiedId.value = null` when that row's `configuredDirectory` or `label` changes (or
  fold it into a `watch` on the environment list), matching the reset discipline the card already
  applies to `reloadCommandCopied`.
- **Task 089 review: routing the clipboard copy through `runClaudeEnvironmentAction` makes a
  post-write `getSnapshot()` failure report a *successful* copy as a failure.** The task's
  contract-defect note accounts for the extra round trip but not for its error-attribution
  consequence. `runClaudeEnvironmentAction`
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:673-674`) runs
  `await callback(); this.applySnapshot(await eyesOnAgentsEmitter.getSnapshot());` — so if
  `getSnapshot()` rejects or times out *after* the clipboard write has already committed in Main,
  `actionError` is set, the action rethrows, and `handleCopySetupCommand`'s `catch`
  (`ClaudeObservationCard.vue:667-668`) clears the confirmation. The user sees an error and no
  `Copied` even though the snippet is on their clipboard. `runCommandAction` (`:644-659`), the horn
  the contract originally named, has no post-action snapshot and therefore no such false negative.
  A related, currently unreachable variant: `runClaudeEnvironmentAction:668` returns **silently** when
  the row id is already busy, which would render `Copied` without copying — only prevented today by
  the button's `:disabled` binding. Consider skipping the snapshot refresh for side-effect-only row
  actions, or resolving the confirmation from the callback's own outcome rather than the whole gate's.
- **Task 089 review: the snippet's `#` comment line is rejected when pasted at a
  default-configured interactive zsh prompt.** zsh's `INTERACTIVE_COMMENTS` option is off by default
  and macOS does not enable it (`grep -in interactivecomment /etc/zshrc /etc/zshenv /etc/zprofile`
  → not set). Verified: pasting the two-line snippet into `zsh -f -i` and into `zsh -i` prints
  `zsh: command not found: #` for line 1 before line 2 defines the function correctly. Cosmetic —
  the wrapper still works (`STUB-SAW:[…/.claude2] ARGS:[--probe]`), and Ral's own zsh has
  `interactivecomments` set, and the comment is fine in a profile file. But
  `docs/integrations/eyes-on-agents-layout.md:310` and the feature doc both describe the snippet as
  "ready-to-paste", so a default-zsh user gets a spurious error. No change recommended unless the
  paste-at-prompt path becomes load-bearing; note it if the copy ever grows a "paste this into your
  terminal" instruction.
- **Task 089 review: the builder's control-character rejection is the *only* gate for the
  directory (not a second line of defence, as the task doc states), and its error message misreports
  the cause.** `buildEyesOnAgentsClaudeEnvironmentSetupCommand`
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:465-467`) throws
  `'Claude environment setup command requires a configured directory'` for `\0`/`\r`/`\n`, which is
  confusing when a directory *is* configured and merely contains a control character. It matters more
  than a wording nit because the claimed upstream gates do not exist — see the evidence correction
  below: `requireCanonicalClaudeConfigDirectory`
  (`src/main/eyesOnAgents/claudePath.resolver.ts:31`) rejects only `\0`, and a directory whose name
  contains `\n` is realpath-able and non-symlink on this macOS (verified:
  `fs.realpathSync.native` returns `"…/a\nb"`, `isDirectory: true`, `isSymlink: false`), so it would
  pass canonicalization and reach the builder. Behavior is safe either way (it throws, nothing
  reaches the clipboard), so this is message accuracy plus a defence-depth gap. Split the two
  conditions into distinct messages, and if `\r`/`\n` should really be impossible upstream, add the
  check to `requireCanonicalClaudeConfigDirectory`.
- Task 090 review: `ClaudeObservationService`'s two `this.pluginPresence.delete(...)` calls
  (`src/main/eyesOnAgents/claudeObservation.service.ts:473` on environment removal, `:485` on a
  config-directory change) are **not covered by any test**. Deleting either line leaves
  `scripts/eyes-on-agents/claude-environment-install-probe.test.mjs` fully green (verified by
  mutation), because scenarios 6 and 7 both `await applyEnvironments()`, which awaits the re-probe
  that overwrites the stale verdict anyway. The delete at `:485` *is* load-bearing in the one case
  the suite does not exercise: a directory change whose re-probe then **fails** leaves the cache
  untouched, so without the delete the row would keep displaying a verdict probed against the old
  directory instead of falling back to `unknown`. Add that scenario (change directory → probe
  rejects → assert `pluginPresence === 'unknown'` and `pluginProbedAt === null`).
- Task 090 review: `presenceClass()`
  (`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue:538-545`) is
  unasserted — the render tests match only pill **text**, never the pill class. Deleting the
  `not_installed → eyes-connection-card__status--stopped` case leaves all 17 tests in
  `claude-environment-render.test.mjs` green (verified by mutation), so the presence pill's
  installed/needs_review/stopped colour mapping can regress silently. Assert `classList` on the
  `eyesOnAgents__connections__claudeEnvironmentPlugin` pill for at least the `installed` and
  `not_installed` rows.
- Task 090 review: `refreshPluginPresence` is called *after* `runClaudeBridgeLifecycle(...)` in
  `installClaudePlugin` / `refreshClaudeBridgeStatus` / `removeClaudeBridge`
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:2923`, `:2983`, `:3003`), not in a `finally`. A
  **partially** failed install — the plugin installs but the hook listener fails to start, so the
  lifecycle body rethrows (`:2913`) — skips the re-probe entirely, leaving the row's pill at its
  pre-install verdict. The user sees "Plugin not installed" plus an Install button for a plugin that
  is now installed. Move the re-probe into a `finally`.
- Task 090 review: the card-level Repair / Enable / Finish / Retry-listener buttons call
  `installClaudeBridge()` / `refreshClaudeBridgeStatus()` with no `environmentId`
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:344`, `:350`), which reaches
  `refreshPluginPresence(undefined)` and therefore probes **every** configured environment —
  2 `claude` CLI calls per environment per click. The contract's trigger list is "an explicit
  install/refresh/retry action on **that row**"; probing all rows for a card-level action is
  defensible but undocumented and uncosted. Either scope it to `environments[0]` (the directory the
  card-level action actually targets) or document the fan-out in
  `docs/features/eyes-on-agents-claude-multi-environment.md`.
- Task 090 review: `resolveExecutable()`
  (`src/main/eyesOnAgents/claudePluginBridge.service.ts:1490-1518`) is a plain check-then-set with
  no in-flight coalescing, so N environments probing concurrently at app start each run their own
  candidate scan (up to two 30 s `claude … --help` spawns per candidate). The per-environment probe
  coalescing added by task 090 does not help, because it is keyed per environment id while the
  executable resolution is profile-wide. Coalesce `resolveExecutable()` onto a single in-flight
  promise.
- Task 090 review: the two new row buttons use the **global** `eyesOnAgentsStore.busyAction`
  for `:loading` and `:disabled` (`ClaudeObservationCard.vue:174-176`, `:184-186`), so clicking
  Install on one row spins the Install button on every other `not_installed` row and disables every
  row's Check. Harmless pre-090 (all rows rendered the same button); newly misleading now that rows
  genuinely differ. `busyClaudeEnvironmentIds` already exists for exactly this
  (used by Retry/Remove at `:147-148`, `:205-207`) — use it, or accept that only one bridge
  mutation can be in flight and grey the others explicitly.
- Pre-existing, unrelated to the iTerm2 Open feature: `yarn check:renderer-i18n` crashes on
  `assert(trayCreateIndex > homeCreateIndex, 'Tray must follow Home creation')`
  (`scripts/renderer-i18n/check-renderer-i18n.mjs:186`) because commit `c67ac21` changed
  `trayHelper.init(mainWindowHelper)` to `trayHelper.init({ ... })` in `src/main/app.main.ts` without
  updating the check script's literal-substring probe. The script never reaches any i18n-content
  assertion while this is broken. Fix the probe (or the assertion it feeds) so the i18n check is
  load-bearing again.
