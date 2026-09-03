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
- Pre-existing, unrelated to the iTerm2 Open feature: `yarn check:renderer-i18n` crashes on
  `assert(trayCreateIndex > homeCreateIndex, 'Tray must follow Home creation')`
  (`scripts/renderer-i18n/check-renderer-i18n.mjs:172`) because commit `c67ac21` changed
  `trayHelper.init(mainWindowHelper)` to `trayHelper.init({ ... })` in `src/main/app.main.ts` without
  updating the check script's literal-substring probe. The script never reaches any i18n-content
  assertion while this is broken. Fix the probe (or the assertion it feeds) so the i18n check is
  load-bearing again.
