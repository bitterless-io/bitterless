---
id: eyes-on-agents-claude-multi-env-data-model-084-1
status: pass
reviewed_task: eyes-on-agents-claude-multi-env-data-model-084
target: dev-next-working-tree-2026-09-02 (uncommitted, on top of da5805b)
date: 2026-09-02
review_type: independent-source-and-test
---

# EyesOnAgents Claude Multi-Environment Data Model Review 1

## Findings

### P1

None. No finding contradicts the task file's Required behavior, the corrected design doc, or leaves
a stub/mock/fake in the integration path.

### P2

#### 1. `EyesOnAgentsApi` omission is correctly scoped-out for 084 but will block task 088 unless its task file is amended first — `[P2][non-blocking for 084 / blocking for the not-yet-started 088]`

- **Mechanism confirmed, not assumed.** The renderer's only EyesOnAgents XPC surface is
  `src/renderer/eyesOnAgents/src/emitter/eyesOnAgents.emitter.ts:4-6`:
  `createXpcRendererEmitter<EyesOnAgentsApi>('EyesOnAgentsHandler') as EyesOnAgentsApi`. The
  `electron-xpc` renderer emitter factory is purely generic
  (`node_modules/electron-xpc/dist/renderer/index.d.ts:102`:
  `createXpcRendererEmitter: <T>(className: string) => XpcEmitterOf<T>`) — it does **not**
  structurally derive from the Main handler class at the type level; `T` is whatever the call site
  supplies, and here that is `EyesOnAgentsApi` (`src/shared/eyesOnAgents/eyesOnAgents.type.ts:537`),
  reinforced by a redundant `as EyesOnAgentsApi` cast. `EyesOnAgentsHandler` is registered by
  runtime reflection on the class instance (`electron-xpc`'s Main-side auto-registration), which is
  why the 7 new methods work at runtime without touching the interface — but that reflection has no
  effect on what the renderer's compiler sees.
- **Consequence confirmed.** `eyesOnAgentsEmitter.listClaudeEnvironments()` (and the other 6) will
  fail to typecheck for task 088 with "Property does not exist on type `EyesOnAgentsApi`" until
  either the interface is extended or the call is type-escaped. This is not speculative — it follows
  directly from the generic/cast mechanism above, independent of whether task 088 has started.
- **Why extending `EyesOnAgentsApi` was correctly left out of 084's Path.** `EyesOnAgentsService`
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:668`, ~3,711 lines) independently
  `implements EyesOnAgentsApi`, and every existing `EyesOnAgentsHandler` method that implements the
  interface delegates to it (e.g. `src/main/xpc/eyesOnAgents.handler.ts:396-404`
  `changeClaudeDirectory`/`useAutomaticClaudeDirectory`/`retryClaudeDirectory` →
  `eyesOnAgentsService.*`). Extending the interface would force TypeScript to require matching
  methods on that second, out-of-Path implementer — verified by the developer's own account that an
  earlier attempt doing exactly this surfaced a real `implements` compile error
  (task file lines 232-234). The task's declared Path
  (`docs/plan/tasks/eyes-on-agents-claude-multi-env-data-model-084.md:57-68`) does not include
  `eyesOnAgents.service.ts`, and the Required-behavior text only requires the "XPC surface... gains
  the environment-scoped equivalents," which the reflection-based registration satisfies.
  **Verdict: this scope call is correct for 084.**
- **The gap is real and currently undocumented where it will be discovered.** Task 088's own file
  (`docs/plan/tasks/eyes-on-agents-claude-multi-env-renderer-088.md`, Path section lines 62-76) lists
  `eyesOnAgents.store.ts` as needing "new environment CRUD store methods... mirroring the existing
  `openThread`/`openThreadInIterm2` call/error-handling pattern" but does **not** list
  `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (where `EyesOnAgentsApi` lives) or
  `src/main/eyesOnAgents/eyesOnAgents.service.ts` anywhere in its Path, even though 084's own
  Implementation evidence (task file lines 164-173) explicitly names task 088 as the one that will
  need to touch both. Whoever picks up 088 will hit this as an unexplained mid-task compile error and
  then have to expand their own declared Path to fix it — exactly the kind of scope surprise the
  docs-sprint Path contract exists to prevent.
- **Recommendation.** Before task 088 starts, amend
  `docs/plan/tasks/eyes-on-agents-claude-multi-env-renderer-088.md`'s Path and Required-behavior
  sections to explicitly add `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (extend `EyesOnAgentsApi`
  with the 7 methods) and the matching 7 one-line delegating methods on
  `src/main/eyesOnAgents/eyesOnAgents.service.ts`. This is the "low-risk one-line-per-method
  addition" the task file itself anticipated (lines 171-173) — it does not need to happen in 084, but
  it does need to be an explicit, planned part of 088 rather than a discovery. Extending the
  interface now instead of at 088 was a legitimate alternative (the ripple is mechanical and would
  have made 088 strictly easier), but leaving it to 088 is also defensible given 084's declared Path
  boundary; the actual defect is that 088's task file doesn't yet reflect the handoff its sibling
  task already documented.

#### 2. `docs/features/eyes-on-agents-iterm2-open.md` gains 52 out-of-Path lines not accounted for anywhere in 084's Implementation evidence, and they misattribute their own follow-up to "task 084" — `[P2][non-blocking]`

- **Diff:** `git diff da5805b -- docs/features/eyes-on-agents-iterm2-open.md` adds a "Concurrent
  sessions" section and an "Agent Connections guidance" section (lines 151-202 in the new file).
- **Not in Path.** Task 084's Path list
  (`docs/plan/tasks/eyes-on-agents-claude-multi-env-data-model-084.md:57-68`) does not include this
  file, and the task's "Implementation evidence" section (lines 83-235) never mentions it — unlike
  `eyes-on-agents-claude-observation.md`, whose edit is explicitly called out in the task's Context
  section (task file lines 23-25) and design doc (design doc lines 14-16).
- **Internally inconsistent content.** The new "Concurrent sessions" section says "See task 084 for
  the regression test that pins this down explicitly" (`docs/features/eyes-on-agents-iterm2-open.md:170`),
  and the new "Agent Connections guidance" section says "task 084 owns the exact DOM placement
  decision within that constraint" (`docs/features/eyes-on-agents-iterm2-open.md:200`) — describing a
  concurrent-iTerm2-session regression test and a
  renderer DOM/i18n note. Neither exists anywhere in the actual task 084 (data-model/CRUD only, no
  renderer, no iTerm2-session test) that this review is verifying. This reads as stale content
  authored under an earlier task-numbering scheme (before "084" was reused for the multi-environment
  data model) that never got committed with the rest of the iTerm2-Open delivery (da5805b), and is
  now sitting, uncommitted, in the same working tree as 084's real changes.
- **Impact.** No test, typecheck, or runtime behavior depends on this file, so it does not affect
  084's own correctness. But left as-is it will confuse whoever next reads
  `eyes-on-agents-iterm2-open.md` looking for the "task 084" it names.
- **Recommendation.** Either commit this content separately under its correct (likely already-shipped
  or different) task attribution, or remove/revert it from the working tree — it should not ride
  along uncommitted inside 084's changeset with an incorrect cross-reference.

### P3

#### 3. `ClaudeDirectoryConfigService.getCurrent()` is now dead code — `[P3][non-blocking]`

- `src/main/eyesOnAgents/claudeDirectoryConfig.service.ts:193-195` still exports `getCurrent()`. The
  only caller before this change was `claudeObservation.service.ts`'s old `directoryConfig` Pick
  clause (`'hydrate' | 'getCurrent' | 'chooseCustom' | 'useAutomatic'`); the new Pick clause
  (`src/main/eyesOnAgents/claudeObservation.service.ts:103-105`) drops `getCurrent` in favor of
  `listEnvironments`. A repo-wide grep confirms zero remaining callers and zero test references. Not
  required by the design doc's CRUD list (design doc lines 112-122) either. Per this repo's
  "Surgical Changes... clean only unused code from own change" convention, this should have been
  removed as part of 084's own diff. Does not affect typecheck (dead but still type-correct) or any
  test.

#### 4. `useAutomatic({id})`-on-a-promoted-`environments[0]` is not exercised end-to-end by a test — `[P3][non-blocking]`

- The design doc's corrected "Data model" section states that removing `environments[0]` "promotes
  the next entry into that slot, which then becomes the one environment eligible for `useAutomatic`"
  (design doc lines 84-88). The implementation achieves this for free via plain array
  filtering (`removeEnvironment`, `src/main/eyesOnAgents/claudeDirectoryConfig.service.ts:237-246`,
  preserves relative order of the remaining entries) plus `useAutomatic`'s existing `index !== 0`
  check (lines 284-304). `scripts/eyes-on-agents/claude-environment-config.test.mjs:121-137` verifies
  the promotion (removed environment's successor becomes `environments[0]`) but the test file's
  `useAutomatic` scenarios (lines 99-119) run *before* the removal scenario, so no test calls
  `useAutomatic` on the newly-promoted id afterward. Low risk given `useAutomatic`'s index check is
  independently well-covered, but it means the design doc's specific promotion-then-eligible claim is
  verified only structurally, not behaviorally end-to-end.

#### 5. Only 2 of 7 CRUD methods have an explicit "persistence failure leaves state intact" test; the other 5 rely on the shared `persist()` helper by construction — `[P3][non-blocking]`

- `persist()` (`src/main/eyesOnAgents/claudeDirectoryConfig.service.ts:341-348`) is the single
  chokepoint all 7 mutation methods funnel through, and it does `await upsert(...)` before
  `this.environments = environments`, so every method inherits the correct persist-before-mutate
  ordering by construction, not by per-method duplication. But an explicit regression test for the
  failure path (a rejected `upsert` leaving `this.environments` unchanged) exists only for
  `chooseCustomDirectory`/`useAutomatic`
  (`scripts/eyes-on-agents/claude-directory-config.test.mjs:241-245`), not for `addEnvironment`,
  `renameEnvironment`, `removeEnvironment`, or `setEnvironmentEnabled`. A future refactor that moved
  one of those methods off the shared `persist()` helper would not be caught by today's suite.

#### 6. `listEnvironments()` can return `[]` before the config service's own `hydrate()` has ever run — `[P3][informational, no current caller affected]`

- `listEnvironments()` (`src/main/eyesOnAgents/claudeDirectoryConfig.service.ts:197-199`) returns
  `(this.environments ?? []).map(...)`, i.e. `[]` when nothing has hydrated yet. The new
  `listClaudeEnvironments` XPC method (`src/main/xpc/eyesOnAgents.handler.ts:411-413`) calls this
  directly, independent of `ClaudeObservationService`'s own startup hydration sequence. If a renderer
  (task 088) calls `listClaudeEnvironments()` before Main's observation service has completed its
  first `hydrate()`, it will see an empty list rather than the eventual default environment. Not a
  defect in 084 (084 has no renderer caller yet, and 084's own tests always hydrate the service
  before calling `listEnvironments()`), but worth flagging for task 088/085 to make sure the renderer
  either waits for the first snapshot or treats an empty list as "not yet initialized" rather than
  "no environments configured."

## Priority investigation summaries

**1. `EyesOnAgentsApi` omission** — confirmed real (see Finding 1). The renderer's typed surface is
nominal, not structural: it derives from the explicit `EyesOnAgentsApi` generic/cast in
`eyesOnAgents.emitter.ts`, not from any structural inference over the handler class. `yarn
typecheck:eyes-on-agents:core` and `yarn typecheck:eyes-on-agents:ui` both pass today (0 errors) —
re-run and confirmed myself — but this is because no renderer code yet references the 7 new methods,
not because the gap is closed. Leaving `EyesOnAgentsApi` unmodified is the right call for 084's own
declared scope (extending it would force an out-of-Path ripple into the 3,711-line
`eyesOnAgents.service.ts`, confirmed by the developer's own documented failed attempt). It is not a
blocking problem for 084. It is a confirmed, non-speculative problem for task 088 that its own task
file does not yet account for — recommend amending 088's Path before it starts (Finding 1).

**2. `claudeObservation.service.ts` out-of-Path adaptation** — confirmed minimal and correctly scoped.
The diff (`src/main/eyesOnAgents/claudeObservation.service.ts`) only changes type annotations
(`EyesOnAgentsClaudeDirectoryConfig` → `EyesOnAgentsClaudeEnvironment`), the `directoryConfig`
dependency's Pick clause, and adds two small private helpers (`requireDirectoryConfig`,
`resolveDefaultEnvironmentId`) purely to resolve `environments[0]`'s id for the now-id-scoped
`chooseCustomDirectory`/`useAutomatic` calls. No `Map<environmentId, ...>`, no new supervisor
instance, no change to watcher/retry/generation logic — it still tracks exactly one `appliedConfig`
keyed implicitly to `environments[0]`, matching the claim that task 085's future
`Map<environmentId,...>` fan-out is untouched groundwork, not partially implemented here. The
existing runtime/race test files (`claude-directory-runtime.test.mjs`,
`claude-directory-runtime-race.test.mjs`) were mechanically updated to the new mock shapes
(`listEnvironments`/`chooseCustomDirectory` instead of `getCurrent`/`chooseCustom`, `schemaVersion: 2`
wrapper) with their actual assertions (retry backoff timing, capability-clear ordering, stale-write
rejection, malformed-then-recovered status) preserved verbatim — confirmed by diff inspection, not
weakened. All 3 files pass when run directly (`node scripts/eyes-on-agents/claude-directory-runtime.test.mjs`,
`claude-directory-runtime-race.test.mjs`, plus the config test) — re-run myself, exit 0 for all.

**3. Persist-before-mutate fix** — description is accurate, fix is correct and proven by a real test,
no new bug found. Comparing against `git show da5805b:src/main/eyesOnAgents/claudeDirectoryConfig.service.ts`,
the **pre-084 production service already persisted before mutating** (`await upsert(...)` then
`this.config = {...config}`). The task file's evidence text (lines 130-136) is careful to attribute
the "mutate before persist" bug to "an earlier draft" of the developer's own new code during this
task, not to the shipped pre-084 service — that framing is accurate, not an overclaim. The final
`persist()` (`claudeDirectoryConfig.service.ts:341-348`) correctly persists first. The specific
regression is asserted behaviorally, not just structurally:
`claude-directory-config.test.mjs:241-245` sets `failPersistence = true`, calls
`chooseCustomDirectory`, asserts the rejection, and then asserts
`mutableConfig.listEnvironments()[0].configDirectory` is still the pre-mutation value — re-run myself,
passes. No half-mutated-state leak: every mutator builds a fresh `next`/`environment` array/object
before calling `persist()`, and `this.environments` is only reassigned after `upsert` resolves, so a
concurrent `listEnvironments()` call during a pending persist sees the fully-consistent prior state,
not a torn write. See Finding 5 for the one real gap: this ordering is proven for 2 of 7 methods
explicitly, not all 7 (though all 7 share the same `persist()` chokepoint by construction).

## Standard checks

1. **Required behavior vs. implementation** — matches. `environments[0]`-only `automatic` mode is
   enforced both at parse time (`parseV2Config`, `claudeDirectoryConfig.service.ts:103-105`: an
   `automatic` entry not at index 0, or more than one, invalidates the whole persisted value) and at
   mutation time (`useAutomatic` rejects `index !== 0`, lines 294-296); `addEnvironment` always
   creates `mode: 'custom'` (lines 212-218); V1→V2 migration produces exactly one `Default`/
   `automatic-or-custom-matching-legacy`/`enabled: true` environment with a fresh uuid and persists
   once (lines 172-188, confirmed by `claude-directory-config.test.mjs`'s migration-writes-once
   assertion); a missing value hydrates the same default without persisting (lines 148-153);
   `removeEnvironment` rejects only the last-remaining case, no index-0 carve-out, matching the
   task's corrected text and the design doc's corrected "Data model" note (lines 237-246);
   `useAutomatic` rejects a non-eligible environment with a clear message (line 295). Log-line
   contract verified by reading the actual `logLifecycle` call sites (never passes `configDirectory`,
   lines 350-360) and by the passing `doesNotMatch(configA/configB)` assertions in
   `claude-environment-config.test.mjs:141-146` and the printed `[claude-environment]` lines observed
   during my own test runs (e.g. `action=directory-change id=... label="Default"` — no path).
2. **Scope** — one unjustified out-of-Path file beyond the acknowledged `claudeObservation.service.ts`
   adaptation: `docs/features/eyes-on-agents-iterm2-open.md` (Finding 2). No watcher-supervisor,
   plugin/hook-install, Hook-payload, or renderer code is touched — confirmed via
   `git diff --stat da5805b` (12 files, all shared/main/scripts/docs; nothing under
   `src/renderer/`, `claudePluginBridge`, or `claudeHookBridge`).
3. **Test quality** — not tautological. `claude-environment-config.test.mjs` exercises the real
   `ClaudeDirectoryConfigService` against a stateful settings double (not a mock that just echoes
   inputs) and covers every item in the task's Verification section: per-method mutate-only-target,
   add validation (empty label, nonexistent directory) rejecting without persisting,
   `useAutomatic`-on-non-eligible rejecting without mutating, last-environment-removal rejecting
   without persisting, and the full log-line/no-configDirectory assertion. `claude-directory-config.test.mjs`
   independently covers migration-writes-once, V2 round-trip-no-rewrite, the widened malformed-shape
   matrix (duplicate id, automatic-not-at-0, two automatics, empty environments, oversized budget at
   the new 65,536-byte threshold), and the persist-failure-preserves-state path.
4. **Verification commands — all re-run by me just now, real results, not the developer's claims:**
   - `node --test scripts/eyes-on-agents/claude-environment-config.test.mjs` — **PASS**, 1/1.
   - `node scripts/eyes-on-agents/claude-directory-config.test.mjs` — **PASS**.
   - `node scripts/eyes-on-agents/claude-directory-runtime.test.mjs` — **PASS**.
   - `node scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs` — **PASS**.
   - `yarn test:eyes-on-agents:claude` — **PASS**, every plain-`node` script printed its own "passed"
     line and every `node --test` group reported 0 failures (46 individual `node --test` cases across
     the grouped files plus 4 plain-script runs, all green).
   - `yarn test:eyes-on-agents` (full) — **PASS**, exit 0, 75/75 in the final `--test` group plus every
     earlier `core`/`project-resolver`/`repository`/`app-server`/`bridge`/`claude` group green.
   - `yarn typecheck:eyes-on-agents:core` (`tsc -p scripts/eyes-on-agents/tsconfig.strict.json`) —
     **PASS**, exit 0, 0 errors.
   - `yarn typecheck:eyes-on-agents:ui` (`vue-tsc --noEmit -p scripts/eyes-on-agents/tsconfig.ui.json
     --composite false`) — **PASS**, exit 0, 0 errors (see Priority investigation 1 for why this
     passing is not proof the `EyesOnAgentsApi` gap is harmless — it is proof no renderer code
     currently exercises it).
   Electron was not launched; no E2E/Playwright suite was run, per instruction.
5. **Style** — consistent with this repo's TypeScript house style: standalone functions are
   `const`+arrow (`parseLabel`, `parseEnvironment`, `parseV2Config`, `parseV1Config`,
   `freshAutomaticEnvironment`, `pickClaudeConfigDirectory`), class methods stay method-shorthand, no
   `forEach` (checked: none in the 5 touched `src/` files — `map`/`filter`/`findIndex` throughout),
   no lodash, plain `throw new Error('...')` strings matching the established Main-process error
   convention (cross-checked against `eyesOnAgents.service.ts`'s existing `throw new Error(...)`
   calls), semicolons present throughout, every new/changed method takes at most one params object.

## Conclusion

**pass**

Task 084's own declared contract — data model, migration, CRUD, XPC registration, logging, and the
focused test/typecheck verification set — is implemented correctly and matches both the task file's
Required behavior and the design doc's corrected Data model section. All six verification commands
were re-run independently in this review and all pass with real 0-failure/0-error results. The
persist-before-mutate claim is accurate and the fix is proven by a real regression test, not merely
asserted. The one file (`docs/features/eyes-on-agents-iterm2-open.md`) touched outside 084's declared
Path is a documentation-only, non-functional issue (Finding 2) that does not affect any test, build,
or runtime behavior. The `EyesOnAgentsApi` interface gap (Finding 1) is a correct scope decision for
084 in isolation, but is a confirmed, non-speculative blocker for the not-yet-started task 088 that
088's own task file does not currently anticipate — recommend amending 088's Path/Required-behavior
before that task begins, rather than leaving it as a mid-task discovery.
