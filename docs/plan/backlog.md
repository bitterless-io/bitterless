# Delivery Backlog

Non-blocking review findings are recorded here after task verification.

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
