# `bitterless-provider-readiness-189` — independent review 1

Date: 2026-09-24. This is a read-only review by a verifier who did not implement the change. No source was edited, nothing was committed, no branch was touched, no app or E2E was started, and no real backend was called.

Contract:

- [issue #契约](../../issues/bitterless-provider-asks-to-sign-in-inside-chat.md)
- [feature "Where it registers, and why there"](../../features/bitterless-model-provider.md)
- Cowork reference: `coworkLlm.service.ts` `checkLlmProviderReady`, the `ai-crms` branch

Reviewed diff: `maestroLlm.service.ts`, `maestroWindow.controller.ts`, `ControlApp.vue`, `compaction.handler.ts`, and the comments in `piRuntimeAdapter.ts` and `llmModels.ts`. Also reviewed: the feature doc, `docs/INDEX.md`, the new `tests/maestro/bitterlessProviderReadiness.test.mjs`, and the stub added to `maestroCompactionHandler.test.mjs`. Another session's uncommitted files (`package.json`, `shortcuts.helper.ts`, `applicationFindMenu.service.ts`, the Cmd+W issue and its test) were excluded.

Conclusion: **pass**. There are no P1 findings and nothing is blocking. All five contract items are implemented as written, and no stub, mock or fake remains on a production path. There are two P2 and three P3 findings, all non-blocking:

- F1 needs an explicit accept-or-change decision. My recommendation: accept it and document it.
- F2 is a pre-existing gap of the same class, outside this task's scope.

## Contract check

| Contract item | Code | Verdict |
|---|---|---|
| Bitterless readiness is a pure read: a session is present and the model is a Bitterless preset. No runtime, lock or network. | `maestroLlm.service.ts:183-192` | ✓ Mutants that build a runtime, ignore the session, or ignore preset membership are all caught by the test. |
| A session change re-computes and broadcasts `coach/llm-config`. It subscribes once and never throws. | `maestroLlm.service.ts:236-264`, wired at `maestroWindow.controller.ts:241` | ✓ |
| The Control card no longer calls `loginLlm` for bitterless; it calls `restoreSession()`. Failures are visible and there is no unhandled rejection. Codex is unchanged and so is the card text. | `ControlApp.vue:258-290` | ✓ End states are as specified. See F1 for what happens in between. |
| Compaction registers bitterless before `find()`. | `compaction.handler.ts:56-61` | ✓ The order create → registerProvider → setRuntimeApiKey → find is pinned by the test. |
| Docs and comments are corrected. | feature doc `:46-71`, `piRuntimeAdapter.ts:41-47`, `llmModels.ts:62-63` | ✓ Mostly accurate. See F2 and F3. |

## Findings

### F1 — P2 — non-blocking — the Bitterless "Login" runs Home's full session-recovery path; the chat flash is only the visible part of a main-side suspend/resume

- Design doc: issue #契约 bullet 3 (`:43-46`): `restoreSession()`: 会话有效 → Home 重新推 token → 就绪 (valid session → Home pushes the token again → ready). Also feature doc `:61-68`.
- Code:
  - `ControlApp.vue:264-277`
  - `localHomeAuth.store.ts:166`
  - Home `auth.store.ts:329-359`: `fetchMe` sets `checking = true` at `:335`
  - `homeShellBridge.handler.ts:67-79`: `checking` → phase `restoring`
  - `ControlAuthApp.vue:105/188/239`
  - `applicationAuth.service.ts:101`
  - `maestroWindow.controller.ts:251-254, 539-566`
  - `maestroAgent.service.ts:586`
  - `maestroBrowserView.service.ts:2831`

What one click does:

1. Home's `fetchMe` flips the phase `ready → restoring → ready`, and both Control and main observe it.
2. **Control:** the gate unmounts `ControlApp`, which resets the channel, message, task, workflow, sessionActions and agentBrowser stores. It then shows the "恢复登录状态 / 正在验证已保存的登录状态…" screen (restoring login state / verifying the saved session, with a 取消 (Cancel) button) for as long as `/me` takes. Finally it mounts a new `ControlApp` (`protectedGeneration` is bumped), which reloads its config.
3. **Main:** `applicationAuth` goes not-ready, which runs `suspendAuthenticatedSession()`:
   - `agentService.shutdown()` aborts active turns in every chat, disposes the workflow host, and drops all agents.
   - `suspendProtectedTabs()` closes auth-required composite tabs (today: Trench) and shows the sign-in guide in their place.
   - Afterwards, `resumeAuthenticatedSession()` remounts them.
4. Home then re-runs the post-login activation: `authEmitter.activateSession()`, Todo sync, and sniping-session activation.

Why it does not break the contract: the design prescribes exactly `localHomeAuthStore.restoreSession()` and specifies only the end states: valid → ready, invalid → login form, failures visible. All of those hold. The transition is simply not described.

It matters anyway, because the flip is **load-bearing**. When main already holds the same session, `customerSessionService.set()` does not notify (`customerSession.service.ts:23-25`), so nothing re-broadcasts. That is the case when Control's cached config is merely stale (see F4c). In that case only the remount's fresh `getLlmConfig()` clears the card. So the design's causal chain "Home 重新推 token → 就绪" (Home re-pushes the token → ready) holds only when main was actually missing the session. The implementation's docstring (`ControlApp.vue:258-263`) repeats the same claim.

Practical blast radius: after this fix, the Bitterless card appears only when Home and main disagree (Home is `ready` but main has no session). In that state Bitterless turns cannot run anyway, so the agent shutdown costs little. The real extra cost is Trench tabs reloading, plus the flash itself.

Recommendation: accept this behaviour for 189. Record it in issue #契约 (and in the feature doc's first bullet): the card goes through Home's recovery path, which briefly shows the recovery screen and makes main suspend and resume the authenticated session. If Ral later wants the flash gone, that is a follow-up with two parts:

- A Home bridge command that validates the session and re-pushes it without toggling `checking`.
- An explicit `coach.getLlmConfig()` refresh in the Bitterless branch afterwards. Without this, removing the flip would leave the button doing nothing in the stale-config case.

### F2 — P2 — non-blocking (pre-existing, out of 189's scope) — workflow agents have the same "self-built runtime never learns `bitterless`" gap

- Design doc: issue #根因 6 (`:33-34`) lists compaction as the only other defect of this class. Feature doc `:69`'s bullet heading states a general rule: "**Runtimes built outside the adapter register themselves.**"
- Code:
  - `maestroAgent.service.ts:309-322`: the workflow `runtime` config passes no Bitterless credentials.
  - `workflowEngine/agent.worker.ts:48` runs in a separate `utilityProcess` (`supervisor.ts:132`), where `createWorkflowPiSession()` (`piAgentSession.ts:40-68`) builds its own runtime from the auth and models files.
  - Its only relay hook is typed `providerId: 'ai-crms'` (`protocol.ts:23-30`).
- Effect: with Bitterless selected, every workflow agent fails with `Workflow model authentication unavailable: bitterless/<model>`. That covers the chat's workflow tools (`maestroAgent.service.ts:349`) and the Workflow XPC handler.
- Cowork does not have this gap, because it passes a relay for `ai-crms` (`coworkAgent.service.ts:366-369`, `workflowRelayAuth`).
- This task did not introduce the gap, but the new doc sentence claims a rule the code does not satisfy.
- Recommendation:
  - Now: narrow the feature-doc bullet to name the runtimes that actually register.
  - Follow-up: track the workflow gap as its own issue. The fix crosses a process boundary: main must hand the worker a relay-style `bitterless` credential, as Cowork does. `registerBitterlessProvider()` cannot run in the worker, because it reads main's in-memory `customerSessionService`.

### F3 — P3 — non-blocking (docs) — "manual compaction" and "/compact" are the wrong labels; `resolveTarget()` backs the automatic-compaction real-usage veto

- Design doc: issue #根因 6 (`:33-34`) says "Bitterless 会话上 `/compact` 会报 `not signed in to bitterless`" (on a Bitterless session, `/compact` reports `not signed in to bitterless`). Issue #契约 bullet 5 (`:48`), task Objective 4, feature doc `:69` ("Manual compaction's `resolveTarget()`"), and the new test's name all use the same label.
- Code:
  - `resolveTarget()` is called only from `shouldCompact` (`compaction.handler.ts:133-134`). That is the real-usage veto behind the renderer's automatic compaction (`message.store.ts:1666` `confirmRealUsage`).
  - `/compact` goes through `coach.compactSession` (`ChatPanel.vue:518` → `maestroAgent.service.ts:1544`). That is native pi compaction on the live session, whose runtime comes from `createModelRuntime()` and is already registered.
  - The handler's own `compact()` is retired (`:155-158`).
- The actual pre-fix symptom:
  - `find()` failed, giving `model not found: bitterless/…`.
  - As a result `shouldCompact` returned `reason: 'no-usage'` for every Bitterless session.
  - The real-usage veto was therefore silently skipped, and compaction fell back to the renderer heuristic alone.
  - It was not a `/compact` error.
- The code change is correct and worth keeping, and the test pins the right effect (`under-threshold` instead of `no-usage`). Only the wording should change, to "compaction trigger's real-usage check (`shouldCompact` → `resolveTarget()`)". This also changes what Ral would try when checking by hand: `/compact` never exercised this path.

### F4 — P3 — non-blocking — the latest-wins guard covers only the guarded broadcast path

- Design doc: issue #契约 bullet 2. The task also says "a simple 'latest wins' guard is enough".
- Code: `maestroLlm.service.ts:236-245`; direct broadcasts at `:501` (`performLlmLogin` failure path) and `:535` (`logoutLlm`).

What is correct:

- On success paths the guard is right.
- The last evaluation to start always broadcasts. It starts after the last session change, so the final state is never lost.
- Each caller gets back its own evaluation, not another caller's.
- The overlapping-evaluation test pins exactly this. A mutant with the guard removed is caught.

Residual edges, none a contract violation:

- **(a)** If the newest evaluation *rejects*, the older successful one is still suppressed, so that change is never broadcast. It is only logged. `getLlmConfig()` rarely rejects.
- **(b)** The two direct broadcasts do not bump the generation. An older guarded evaluation still in flight can therefore land after them and overwrite their `ready:false` / `hint`.
- **(c)** RPC replies (Control's `getLlmConfig` / `setLlmConfig`) are not ordered against broadcasts, and Control applies both (`ControlApp.vue:205/416/459`). A pre-change reply can therefore land after a fresher broadcast and leave the card showing.

Separately, `customerSessionService.clear()` notifies even when the session is already null (`customerSession.service.ts:28-31`). Sign-out, which clears the session and then deactivates it, therefore evaluates two or three times. The extra broadcasts are identical and harmless.

(a) and (b) are pre-existing race classes; the session watcher only adds one more concurrent evaluation source. No change is needed for 189.

### F5 — P3 — non-blocking (test) — the production wiring of the subscription is not guarded

- Design doc: issue #验证 "会话变化触发一次 `coach/llm-config` 广播" (a session change triggers one `coach/llm-config` broadcast).
- Code: `maestroWindow.controller.ts:241`.
- The suite calls `service.watchAccountSession()` itself, so deleting the controller line leaves all 8 tests green. If that line is lost in a later refactor, the whole re-broadcast feature disappears silently.
- A one-line source assertion would guard it, in the style other suites use (`source(controller)` matching `this.llmService.watchAccountSession()`).
- The rest of the suite is not tautological. On a scratch mirror, 16 targeted mutants were run and 15 were killed (see below).

## Verification performed

**Re-run.** `node --test tests/maestro/bitterlessProviderReadiness.test.mjs tests/maestro/maestroCompactionHandler.test.mjs` passes 13/13.

**Mutation testing** was done on a scratch copy of `src`; the worktree was untouched. 15 of 16 mutants were killed. Only M8 survived: removing the controller's `watchAccountSession()` call (see F5). The killed mutants:

- The readiness branch removed, the session ignored, preset membership ignored, or a runtime built in the branch.
- Subscribing more than once, or the latest-wins guard removed.
- No `.catch` in the listener.
- In Control: the Bitterless branch calling `loginLlm` again, no `try`/`catch`, a toast shown even when signed out, a silently swallowed failure, or no busy flag.
- In compaction: no registration, registration for every provider, or registration after lookup.

**Neighbouring suites.** `controlLoginLifecycle`, `accountMenu` and `controlAuthLifecycle` pass, except one `controlLoginLifecycle` subtest (see below). Three failures reproduce identically when the six touched files are restored to their HEAD versions, so none comes from this change:

- `controlLoginFrame` fails to build: its vue mock has no `h`, which `ControlAuthApp.vue` imports.
- One `controlLoginLifecycle` subtest fails: its regex expects the old `defineAsyncComponent(() => import(...))` form.
- `maestroControlProviders` fails to build: its stubs do not cover `ControlApp.vue`'s imports.

**Suites that bundle the touched main modules** (21 suites, 162 tests): the set of 37 failures is the same with and without the change. No failure appears only with the change. The HEAD-baseline copy shows one extra failure, which is an artifact of the scratch copy: that test reads `electron.vite.config.ts`, and the copy does not include it.

**Typecheck** (surfaces `main` and `renderer/maestro`, run in a scratch mirror): there are 72 distinct diagnostics both with and without the change. The only difference is two pre-existing `TS2352` in `piRuntimeAdapter.ts`, which moved from lines 213/214 to 217/218 because the comment grew. There are no diagnostics on touched lines.

**ESLint** (touched files, no `--fix` or `--cache`):

- 7 errors, all present at HEAD on untouched lines (unused imports or variables, and one `prefer-const`).
- On added lines, only 23 `prettier/prettier` "Insert `;`" warnings. They are in files whose local style has no semicolons, which is what the task asked for.
- The new test file has no messages.

**Paired development.** Cowork already has the equivalent of each piece:

- An `ai-crms` readiness branch (`coworkLlm.service.ts:217`).
- A re-broadcast on session change (`handleAiCrmsSessionChanged`, `:140`).
- The provider is baked into `models.json`, so its self-built runtimes resolve it.
- A workflow relay for `ai-crms`.

No Cowork change is needed for this task's scope.

**Not run:** Electron E2E, a real-backend turn, and the in-app *Bitterless → Qwen 3.8 Max* run (still owed by Ral, per issue #验证).

**Close-out for the orchestrator:** the task's `status: in-progress` and the issue's "fix in progress" still need updating.
