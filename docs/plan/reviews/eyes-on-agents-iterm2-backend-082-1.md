---
id: eyes-on-agents-iterm2-backend-082-1
status: pass
reviewed_task: eyes-on-agents-iterm2-backend-082
target: working-tree-2026-09-02 (uncommitted, on top of 3f42ba9)
date: 2026-09-02
review_type: contract-and-test-audit
---

# Independent Review — eyes-on-agents-iterm2-backend-082

## Verdict

**PASS.** Persistence, service, and XPC changes match the feature doc's "Persisted identity",
"Visibility", "Open", and "XPC surface addition" sections and the task file's "Required behavior"
exactly. The new `eyes_on_agents_thread.iterm2_session_id` column follows the project's real,
existing migration mechanism byte-for-byte (same `addColumnIfMissing` shape as the immediately prior
`ensureEyesOnAgentsClaudeDeletionSchema` addition, wired into both `finalizeCoreSqliteSchema` and
`coreSqliteMigrations` with the next sequential `versionCode`). `upsertClaudeInventory`'s
COALESCE-preserve rule for `iterm2SessionId` is independent of the `desktop_session_id`
ambiguity/collision machinery on both the insert and update paths — traced the positional SQL
argument lists for both statements column-by-column against the `VALUES`/`SET` clauses; the new
column slots into the correct position with no off-by-one binding error. `getSnapshot()`'s visibility
filter is exactly the documented OR condition and nothing else in that method changed.
`openThreadInIterm2` never touches the Desktop deep-link builder or `syncOpenedThreadStatus`, rejects
a `codex` row and a null-`iterm2SessionId` claude row, and `openThread` (lines 2230–2264) is verified
byte-for-byte identical to `HEAD` by direct diff, not by trusting the task's claim. Zero renderer
files are touched (confirmed via `git diff --stat`). The claimed "latent gap" fix in
`claude-visibility-lifecycle.test.mjs`'s mock fixture is a real, correct fix to that one test's mock
data only — the production DAO path was never affected by the gap (see Finding 1). All five mandated
verification commands were re-run by this review and passed with the exact counts the developer
reported.

## Circular import investigation (priority concern)

**Confirmed: this is a real, new, bidirectional ESM cycle between the two contract files — not a
hypothetical one — and it is safe.**

1. **Import graph, traced both directions:**
   - `src/shared/eyesOnAgents/eyesOnAgents.contract.ts:16` — new:
     `import { CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN } from './claudeHookBridge.contract';` (value
     import).
   - `src/shared/eyesOnAgents/claudeHookBridge.contract.ts:19-24` — **pre-existing**, landed in task
     081's already-merged commit `3f42ba9` (confirmed via `git show 3f42ba9:...`), and present even
     before that per the file's own history: `import { isEyesOnAgentsRecord, parseEyesOnAgentsPath,
     parseEyesOnAgentsTimestamp, parseEyesOnAgentsUuid } from './eyesOnAgents.contract';` (value
     import).
   - So task 082 did not invent the dependency direction `claudeHookBridge.contract.ts →
     eyesOnAgents.contract.ts` — that already existed and is one-directional/acyclic on its own. Task
     082 is what closes the loop by adding the reverse edge `eyesOnAgents.contract.ts →
     claudeHookBridge.contract.ts`. Before this change, `eyesOnAgents.contract.ts` had zero
     dependency on `claudeHookBridge.contract.ts`.
   - No transitive cycle through the type files: `eyesOnAgents.type.ts` and
     `claudeHookBridge.type.ts` have zero `import` statements (verified by grep), so the cycle is
     confined to exactly these two `.contract.ts` files, matching the developer's account.

2. **Usage site check — function-body-only on both sides (safe pattern):**
   - `CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN` is referenced exactly once in
     `eyesOnAgents.contract.ts:117`, inside the body of `parseEyesOnAgentsIterm2SessionId`
     (`eyesOnAgents.contract.ts:112-121`). No top-level `const` in that file is initialized from it
     (verified by listing every top-level `const`/`export const` in the file).
   - `isEyesOnAgentsRecord`/`parseEyesOnAgentsPath`/`parseEyesOnAgentsTimestamp`/`parseEyesOnAgentsUuid`
     are referenced only inside function bodies in `claudeHookBridge.contract.ts` (lines 138-465, all
     inside `createClaudeHookEventV1/V2/V3`, `parseClaudeHookEvent`, and sibling functions) — never at
     that file's module top level either.
   - Conclusion: neither module's top-level (synchronous, import-time) evaluation touches the other
     module's exports. This is the textbook safe two-file ESM cycle shape; TDZ/undefined-binding
     hazards only arise when a cyclic import is dereferenced during the importing module's own
     top-level evaluation, which does not happen here in either direction.

3. **Does `node --test`'s loading exercise a real bundler, and does a real production build resolve
   it?** Yes to both, verified independently by this review, not by re-reading the developer's claim:
   - Three of the touched/added test files (`scripts/eyes-on-agents/claude-iterm2-open.test.mjs`,
     `scripts/eyes-on-agents/repository.test.mjs`, `scripts/eyes-on-agents/claude-visibility-lifecycle.test.mjs`)
     do not use `ts-node`/`tsx` per-file transpilation — they call `esbuild.build({ bundle: true, ... })`
     against real `.ts` entry points (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts`,
     `src/main/eyesOnAgents/eyesOnAgents.service.ts`) and `import()` the bundled output. This is a real
     bundler resolving the cycle, not a loader that treats each file as an independent CJS/ESM module.
     `claude-iterm2-open.test.mjs` is an especially strong case: it bundles `eyesOnAgents.contract.ts`
     and `eyesOnAgents.service.ts` as **two separate esbuild entry points**, which varies which file's
     evaluation "wins" the root position in each bundle graph — and it still passed.
   - Ran `node --test scripts/eyes-on-agents/claude-iterm2-open.test.mjs` directly: **4/4 pass**.
   - Went further than the task's suggested checks and ran the actual production bundler,
     `yarn build` (`electron-vite build`, Rollup-based, compile-only — no Electron process/window
     launched): the **main** process SSR build succeeded and emitted
     `out/main/chunks/eyesOnAgents.contract-DCqXiKWn.js` (30.40 kB) cleanly; the **preload** SSR build
     (which bundles `eyesOnAgents.dao.ts`, importing `parseEyesOnAgentsIterm2SessionId` from the same
     contract file) also succeeded. The renderer sub-build failed, but on an `ENOENT` for
     `out/renderer/trench-io/index.html` from an unrelated custom Vite plugin
     (`bitterless:trench-io-blank-html`) for a feature this task's diff never touches (no
     `trench-io` file appears anywhere in `git diff --stat`); this is a pre-existing environment issue,
     not something this task introduced or something the circular import caused.
   - Together: one esbuild-based check (used by the project's own tests) plus one independent
     Rollup-based production build both resolve the cycle cleanly. This is materially stronger
     evidence than the task's own minimum bar ("if you can find and run a real build step, do so").

4. **Architectural opinion (non-blocking):** The task file's own "Required behavior" explicitly
   mandated reusing "task 081's `ITERM_SESSION_ID` shape validator rather than redefining the pattern
   a third time," and the feature doc's code sketch already showed this exact import before 082
   started — so the developer was executing a decision made upstream of this task, not inventing it.
   Given the *existing* dependency already ran `claudeHookBridge.contract.ts → eyesOnAgents.contract.ts`,
   a zero-cycle alternative did exist in principle: define the canonical pattern constant in
   `eyesOnAgents.contract.ts` (the file the other one already depends on) and have
   `claudeHookBridge.contract.ts` import it from there, preserving the pre-existing one-directional
   edge instead of adding a reverse one. That alternative was not realistically available to task 082
   without retroactively touching task 081's already-landed, already-reviewed file to relocate the
   constant — a bigger, out-of-scope change for a task whose declared `Path` does not include
   `claudeHookBridge.contract.ts`. Given the constraint actually in force, importing the existing
   export as-is and documenting the resulting cycle (in both the feature doc and inline code comments)
   is the right, minimal-diff call. One canonical regex beats a second, driftable copy of the same
   shape validator. Recommendation: not blocking; if a third consumer of this pattern ever appears,
   that would be the natural trigger to relocate the constant to `eyesOnAgents.contract.ts` and collapse
   the cycle for good — worth a backlog note, not a redo of this task.

## Findings

### P3 — non-blocking

#### 1. Confirm the visibility-lifecycle test fixture fix does not mask a production gap

- **File:** `scripts/eyes-on-agents/claude-visibility-lifecycle.test.mjs:47-54` (fix);
  `src/preload/sqlite/dao/eyesOnAgents.dao.ts:400-403`, `:154-176` (production path checked)
- Verified independently that the production DAO path can never produce the `undefined`-vs-`null`
  gap the mock fixture had: `toThread()` (the only place `EyesOnAgentsThread` objects are constructed
  from real SQLite rows, used for both providers) always calls
  `parseEyesOnAgentsIterm2SessionId(row.iterm2_session_id)`, which explicitly maps `undefined`/`null`
  to `null` — and `row.iterm2_session_id` is a real SQLite column (nullable, never `undefined`) for
  every row, Codex included, since the migration adds it to the shared `eyes_on_agents_thread` table.
  On the write side, `upsertClaudeInventory` normalizes every incoming thread through
  `normalizeClaudeInventoryThread` (line 2050, `params.threads.map(normalizeClaudeInventoryThread)`)
  before the COALESCE logic runs, which also runs the optional `iterm2SessionId` field through
  `parseEyesOnAgentsIterm2SessionId` and coerces `undefined` to `null`. So the gap the developer
  describes was real only in this one hand-built plain-JS mock object, never in the production
  read or write path. Grepped every other test file that mocks a thread with `desktopSessionId`
  (`claude-hook-prompt-service`, `claude-provider-snapshot-race`, `claude-provider-toggle`) and
  confirmed they all set `desktopSessionId` to a non-null value for their `claude` fixtures, so the
  OR'd visibility filter's outcome does not depend on their (missing) `iterm2SessionId` field —
  no other latent instance of the same test-mock gap affects a real assertion.
- Not blocking: fix is real, correctly scoped, and the underlying concern (does production code
  degrade a missing field to not-visible rather than falsely-visible) is independently verified true.

#### 2. `coreSqlite.release.ts`'s new migration wiring is outside the task's mandated typecheck target

- **File:** `src/preload/sqlite/coreSqlite.release.ts:19,135` (new import/wiring);
  `scripts/eyes-on-agents/tsconfig.strict.json`
- `yarn typecheck:eyes-on-agents:core`'s `include` list covers `src/shared/eyesOnAgents/**`,
  `src/main/eyesOnAgents/**`, `src/main/xpc/eyesOnAgents.handler.ts`, and
  `src/preload/sqlite/dao/eyesOnAgents.*.ts` — it does not include `coreSqlite.release.ts` (one
  directory up from `dao/`), so the task's own mandated command never strict-typechecks the new
  `ensureEyesOnAgentsIterm2SessionSchema` import/registration in that file. Ran
  `yarn typecheck:sqlite-migrations` (a different, pre-existing strict project whose `include` does
  cover `coreSqlite.release.ts`) myself: it passes clean, so there is no actual type error — this is
  purely a coverage-boundary observation, not a defect in the change.
- Not blocking: the file is type-safe by an existing, unrelated strict config; the task's exact
  mandated command set is unchanged from prior tasks in this series and this gap is not new to 082.

## Standard checks

- **Migration mechanism parity:** `ensureEyesOnAgentsIterm2SessionSchema`
  (`src/preload/sqlite/dao/eyesOnAgents.migration.ts:531-534`) mirrors
  `ensureEyesOnAgentsClaudeDeletionSchema` (`:495-503`, the immediately prior addition to this table)
  exactly: `tableExists` guard + `addColumnIfMissing`. Wired into `finalizeCoreSqliteSchema` (fresh
  install/idempotent path) and appended to `coreSqliteMigrations` with `versionCode: '260902120000'`,
  one past `260818190001`, matching every prior entry's ascending pattern
  (`src/preload/sqlite/coreSqlite.release.ts:135,219-222`). Fresh-install `CREATE TABLE` in
  `eyesOnAgents.table.ts:35` carries the column directly, so `addColumnIfMissing` is a correct no-op
  on new installs. Confirmed with `yarn test:eyes-on-agents:repository`'s migration-audit block: both
  the `repairDb` double-run idempotency check and the `oldDb` legacy-upgrade-path assertion cover the
  new column.
- **COALESCE-preserve rule:** Verified both the insert path (`thread.iterm2SessionId ?? null`,
  `eyesOnAgents.dao.ts:2178`) and update path (`thread.iterm2SessionId ?? row.iterm2_session_id`,
  `:2207`) apply the rule with zero reference to `desktopAmbiguous`, `collision`, or the tombstone
  restore logic that exists solely for `desktop_session_id` (`:2146-2160,2194-2196`) — confirmed by
  reading the full update-row block (`:2130-2262`), not just the diff hunks. Traced the positional SQL
  argument order for both the `INSERT` (`:2163-2185`) and `UPDATE` (`:2240-2260`) statements
  column-by-column against their `VALUES`/`SET` lists and `.run()` argument lists: the new
  `iterm2_session_id` slot is in the correct position in both, with no off-by-one shift of any later
  column.
- **`getSnapshot()` visibility filter:** exactly
  `claudeProviderProjectionEnabled && (thread.desktopSessionId !== null || thread.iterm2SessionId !== null)`
  (`eyesOnAgents.service.ts:829-833`); read the surrounding ~75 lines and confirmed no other filter,
  archive-state, Focus, or unread computation changed.
- **`openThreadInIterm2`:** never references `buildEyesOnAgentsClaudeDesktopDeepLink` or
  `syncOpenedThreadStatus` (`eyesOnAgents.service.ts:2266-2287`); rejects a non-`claude` provider row
  (`Thread was not found`) and a `claude` row with `iterm2SessionId === null`/absent
  (`This Claude session is not matched to an iTerm2 session`) — both exercised by
  `claude-iterm2-open.test.mjs`. `openThread` (`:2230-2264`) is verified **byte-for-byte identical**
  to `HEAD` by direct text diff of the extracted method body, not by trusting the evidence section.
- **XPC registration:** `eyesOnAgents.handler.ts:318-323` follows `openThread`'s exact registration
  shape (`:311-316`), reusing `parseEyesOnAgentsSessionKeyParams`. No other XPC method's signature
  changed (confirmed via full file diff).
- **Scope — no renderer files touched:** `git diff --stat` lists 14 modified files, none under
  `src/renderer/`, no `ThreadCard.vue`, no `eyesOnAgents.store.ts`, no `en.ts`/`zh.ts`. The developer's
  claim is correct.
- **Test coverage vs. task's Verification section:** all four bullet points (visibility inclusion/
  exclusion/both-identity case; `openThreadInIterm2` success/codex-reject/null-reject with no Desktop/
  status-sync side effect; DAO COALESCE-preserve both directions + independence from
  `desktop_session_id`) are each covered by a distinct assertion in
  `scripts/eyes-on-agents/claude-iterm2-open.test.mjs` and the new block in
  `scripts/eyes-on-agents/repository.test.mjs`. Tests are meaningful (assert on exact URLs, exact call
  sequences, exact rejection messages, and exact field values) rather than smoke-only.
- **Code style:** arrow-const functions throughout the new code (no `function` declarations
  introduced); no `forEach` introduced (grepped the full diff); file/column naming matches sibling
  conventions; inline comments added at both cycle-forming import sites explain the deliberate reuse,
  consistent with this repo's preference for explicit rationale over silent cleverness.

## Verification re-run (this review, not the developer's report)

- `node --test scripts/eyes-on-agents/claude-iterm2-open.test.mjs` → **exit 0**, `tests 4`, `pass 4`,
  `fail 0`.
- `yarn test:eyes-on-agents:repository` → **exit 0**, `EyesOnAgents repository tests passed`.
- `yarn test:eyes-on-agents:claude` → **exit 0**; the extended `node --test` group that now includes
  `claude-iterm2-open.test.mjs` reported `tests 29`, `pass 29`, `fail 0` — every pre-existing Claude
  test in that group, including the Desktop-route coverage, passed unmodified.
- `yarn test:eyes-on-agents:core` → **exit 0**, `EyesOnAgents core tests passed`.
- `yarn typecheck:eyes-on-agents:core` → **exit 0**, no errors.
- Additional checks run by this review beyond the mandated five, for corroboration: `yarn
  typecheck:eyes-on-agents:ui` (exit 0), `yarn test:eyes-on-agents:ui` (exit 0, `tests 71`, `pass 71`),
  `yarn typecheck:sqlite-migrations` (exit 0, covers `coreSqlite.release.ts` — see Finding 2), and
  `yarn build` (`electron-vite build`; main + preload SSR bundles succeeded, renderer failed on an
  unrelated pre-existing `trench-io` plugin `ENOENT` — see circular-import investigation §3). No
  Electron process or window was launched by any of these commands.

All counts match the developer's reported evidence exactly.

## Conclusion

`pass`
