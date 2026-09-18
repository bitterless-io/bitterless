# Control login inherits OnlyPreview Project — independent review 1

Date: 2026-09-18
Task: [control-login-preview-workspace-001](../tasks/control-login-preview-workspace-001.md)
Conclusion: **pass** after one P2 repair (code verified; live desktop acceptance pending)

Paired with Cowork. The independent reviewer assessed both projects together, since the contract
requires the same behavior on each side. The full finding write-up, including the reasoning that was
identical for both, lives in Cowork's
[`control-login-preview-workspace-001-1.md`](../../../../micromeet-cowork/docs/plan/reviews/control-login-preview-workspace-001-1.md);
this records the Bitterless side.

## Findings

**pass-with-findings**: one P2 and three P3, all repaired here before closing.

- **P2-1 — a fenced adoption left Main bound to a Project the Chat never adopted.** Main binds
  `workspaceRefs[sessionId]` before the renderer's account/selection fence can run, and
  `resolveWorkspacePath` reads exactly that ref. `refreshWorkspace` re-pushes the session's own path
  before every send, but returns early when the session has none — so a Chat carrying no workspace
  never healed and its file tools kept resolving inside the adopted Project.
  **Repair:** new `releaseWorkspaceBinding({ sessionId, path })` on the workspace service, plumbed
  through `maestroWindow.controller`, `coach.handler` and `coach.api`. The renderer's fenced branch
  calls it with the path adoption returned; Main **compares before releasing**, so a newer explicit
  choice for the same session is never clobbered and an already-cleared one is left alone.
- **P3-1 — unguarded XPC call.** Guarded with `.catch(() => null)`, matching every sibling. The blast
  radius here was larger than in Cowork: `ControlApp.vue:386` awaits `channelStore.init()` before
  `getLlmConfig()` with `initialized` already `true`, so a rejection would stall the whole Control
  load until reload. No reachable trigger was found; this is robustness.
- **P3-2 — poisoned default-write chain.** The chain now stores `write.catch(() => undefined)` so one
  failed write cannot silently skip every later default-workspace write.
- **P3-3 — test gaps.** Added Main-binding assertions to the fenced race branches plus a dedicated
  test for a restored Chat with no workspace of its own.

## Bitterless-specific notes

- The host-adapter boundary is preserved: the Project root is still resolved through
  `getMaestroPreviewOpener()?.currentProjectDirectory?.()`, and no OnlyPreview internals were pulled
  into portable Maestro services. The guards that pin `onlyPreviewMaestroOpener.ts`'s shape
  (`onlyPreviewLocalPathAddress.test.mjs` ▸ 宿主那一侧实现端口) still pass.
- `releaseWorkspaceBinding` exists rather than reusing `setWorkspaceDirectory({ path: '' })` precisely
  because Bitterless has no `remember` flag — its empty-path branch also wipes the remembered
  default, which the fenced path must not do. The dedicated method keeps both projects symmetric
  while each keeps its own default semantics.
- `ensureMaestroSession()` can return undefined (Cowork's cannot); the `if (session)` guard at
  `channel.store.ts:107` handles it. The auth lifecycle is unchanged — `authActive` /
  `authGeneration` still fence `refreshDefaultWorkspace`, and Cowork's login implementation was not
  ported over it.

## Independent verification

The reviewer did not modify either repo and proved P2-1 against a scratchpad copy of the real
harness. Re-run after the repair, from the repository root:

```sh
node --test tests/onlypreview/controlLoginPreviewWorkspace.test.mjs \
  tests/onlypreview/onlyPreviewWorkspacePicker.test.mjs tests/onlypreview/onlyPreviewWorkspaceBinding.test.mjs \
  tests/onlypreview/onlyPreviewClearWorkspace.test.mjs tests/maestro/controlLoginLifecycle.test.mjs \
  tests/maestro/controlAuthLifecycle.test.mjs tests/maestro/maestroSessionManagement.test.mjs \
  tests/maestro/sessionIoInitialization.test.mjs tests/maestro/maestroWorkbenchAccount.test.mjs
```

**88/88 passed.** The paired test file is byte-identical to Cowork's, and the no-op-release probe run
in Cowork fails exactly the three new assertions, so they are real regressions.

Full `tests/onlypreview` sweep (with `--test-timeout=60000`): **1346/1372**. The 26 failures are
pre-existing and unrelated — the set is identical to the pre-change run minus one flaky search-progress
case that now passes; **no failure is new**. Only four of them even sit in files that load this
task's sources, and those fail on a missing harness stub
(`@main/miniapps/onlypreview/onlyPreviewClearWorkspace.service`) and on a comment canary in
`maestroBrowserView.service.ts`, which this task does not modify.

`node scripts/typecheck/surfaces.mjs main shared renderer/maestro` → **63 / 3 / 4**, identical to the
pre-change baseline. The only diagnostic naming a changed file is a pre-existing `abortAgent`
mismatch at `coach.handler.ts:299`, unrelated to the added methods.

Not run: the full `tests/maestro` suite, because `maestroConcurrentTurns.test.mjs` hangs indefinitely
under the default runner (no test timeout) on a pre-existing steering case, alongside a pre-existing
`stopSkillContextListener` failure. Neither touches this task — those tests extract only `abortAgent`
and a browser-tool callback from the controller. No app launch, Electron E2E, packaging, or live
login was performed.
