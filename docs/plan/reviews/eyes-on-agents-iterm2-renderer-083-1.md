# Review: eyes-on-agents-iterm2-renderer-083 (independent review 1)

Scope reviewed: uncommitted working-tree diff on top of `78e175d` (task 082, committed), covering
`docs/plan/tasks/eyes-on-agents-iterm2-renderer-083.md`'s "Required behavior" and "Verification"
sections, plus the feature doc's Acceptance section as the last task in this delivery.

Files changed (`git diff --stat HEAD`):

```
docs/integrations/eyes-on-agents-layout.md          |   9 +-
docs/plan/tasks/eyes-on-agents-iterm2-renderer-083.md |  94 +++++++++++++++++-
scripts/eyes-on-agents/focus-board-store.test.mjs   |  48 ++++++++++
scripts/eyes-on-agents/thread-card-open-capability.test.mjs | 105 ++++++++++++++++++++-
src/renderer/common/i18n/en.ts                      |   1 +
src/renderer/common/i18n/zh.ts                      |   1 +
src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue | 17 ++++
src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts | 19 ++++
8 files changed, 289 insertions(+), 5 deletions(-)
```

No backend/DAO/service/XPC file from tasks 081/082 is touched. Scope is clean.

## Findings

### Finding 1 — P3, non-blocking: root-cause commit misattributed in "Verification evidence"

The task file's "Verification evidence" section (and the underlying claim I was asked to verify)
states the `yarn check:renderer-i18n` crash is caused by commit `6caec1a` ("feat: advance Maestro
and OnlyPreview workflows") changing `trayHelper.init(mainWindowHelper)` to `trayHelper.init({ ...
})`. This is factually wrong about *which* commit made that specific syntactic change:

- `git show 6caec1a -- src/main/app.main.ts` shows `trayHelper.init({` as unchanged **context** in
  that diff — 6caec1a only edits the callback bodies already inside the object-literal form
  (swapping `authHandler.showPrimaryWindow()` calls for `maestroWindowHandler.openMaestroWindow()`
  calls). It does not introduce the `{ }` shape.
- `git log --oneline -S"trayHelper.init(mainWindowHelper)" -- src/main/app.main.ts` and
  `git show c67ac21 -- src/main/app.main.ts` (2026-08-24, two days before 6caec1a's 2026-08-26)
  show **commit `c67ac21`** ("feat: consolidate desktop workbench and local Claude accounts") is
  the one that actually replaced `trayHelper.init(mainWindowHelper);` with the
  `trayHelper.init({ show: () => {...} })` object-literal form that
  `scripts/renderer-i18n/check-renderer-i18n.mjs:155`'s
  `appMain.indexOf('trayHelper.init(mainWindowHelper)')` substring search can no longer find
  (returns `-1`), which is what makes the `trayCreateIndex > homeCreateIndex` assertion at line 172
  fail (`-1 > homeCreateIndex` is `false`).

The overarching conclusion — pre-existing, unrelated to this task's diff, script bug rather than an
i18n-content defect — is independently confirmed correct (see below). Only the specific commit
citation in the task doc is wrong. This should be corrected in the task file's prose (`6caec1a` →
`c67ac21`) but does not change the pass/fail outcome of this review.

### Finding 2 — P2, non-blocking (recommend immediate small follow-up, not part of 083): a third stale sentence in the layout doc, missed by the developer's own gap note

The developer's "Acceptance-criterion gap found but not owned by this task" note in the task file
correctly identifies two stale sentences in `docs/integrations/eyes-on-agents-layout.md` that
predate task 082's visibility-filter widening and are now false:

- `docs/integrations/eyes-on-agents-layout.md:363-364` — "the folder exposes the full path through
  tooltip/accessibility text. Claude rows without a trusted Desktop Open route do not render."
- `docs/integrations/eyes-on-agents-layout.md:399-400` — "Claude rows without that trusted Desktop
  route are Main-private inventory and do not render in Focus or modal search results."

Independent verification: the current `getSnapshot()` filter
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:829-833`) is

```ts
const visibleThreads = persisted.threads.filter((thread) =>
  thread.provider !== 'claude' || (
    claudeProviderProjectionEnabled &&
    (thread.desktopSessionId !== null || thread.iterm2SessionId !== null)
  ));
```

confirming a Claude row with only `iterm2SessionId` (no `desktopSessionId`, no "trusted Desktop Open
route") does render. Both quoted sentences are genuinely stale.

**Additional finding beyond what the developer flagged:** a third occurrence of the same stale claim
exists in the States table and was not mentioned in the task file's gap note:

- `docs/integrations/eyes-on-agents-layout.md:486` — "| Claude CLI-only inventory | retained
  internally for reconciliation but absent from board/search until a trusted Desktop mapping exists
  |"

This is the same visibility claim in tabular form and is equally false for a CLI-only row that
carries an `iterm2SessionId` (it is now visible, per the filter above, with no Desktop mapping at
all).

**Severity and blocking recommendation:** This is real doc/code drift on a shipped-and-committed
capability (task 082, commit `78e175d`), not something task 083 introduced or was scoped to fix —
task 083's own diff to this file only touches the overflow-menu item list (lines 365-372), which it
updated correctly. Per this project's docs-sprint rule that a verify-time mismatch between docs and
code should be fixed on the side that's wrong: **recommend patching all three stale sentences as an
immediate, small follow-up right after this review lands, rather than blocking task 083's closure on
it.** Rationale: the wrong prose already existed before task 083 started (introduced as a gap by
task 082, not 083), fixing it is a trivial doc-only edit with no code risk, and blocking a
already-correct, fully-tested renderer task on a pre-existing doc-only defect in a different section
of a different document would not serve the goal of closing this feature — it would only delay a
task that is otherwise complete. The follow-up should not be silently rolled into 083's own
"Implementation evidence"; it should be its own doc-fix change (or amend task 082/create a
docs-only patch) so responsibility stays traceable to where the gap was actually introduced.

### Finding 3 — P3, non-blocking: pre-existing unrelated `yarn build` renderer failure (informational only)

Task 082's own review (`docs/plan/reviews/eyes-on-agents-iterm2-backend-082-1.md:220`) recorded that
`yarn build` (`electron-vite build`) has main+preload bundles succeeding but the renderer step
failing on an unrelated pre-existing `trench-io` plugin `ENOENT`, with no Electron window launched
by the command. This pre-dates task 081 and is untouched by 083 (083 touches only
`ThreadCard.vue`/store/i18n files, none related to `trench-io`). Not re-run in this review since
083's diff cannot affect it and it is out of both 083's and this review's scope; recorded here only
because it bears on Acceptance bullet 8's "production build checks run" wording — see the Acceptance
table below.

## Priority investigation 1 — `yarn check:renderer-i18n` failure

Independently reproduced exactly as claimed:

1. On the current dirty working tree: `yarn check:renderer-i18n` → **exit 1**, crashes with
   `AssertionError [ERR_ASSERTION]: Tray must follow Home creation` at
   `scripts/renderer-i18n/check-renderer-i18n.mjs:172:1`.
2. `git stash push -u` (stashed all 8 modified files), then re-ran on the clean `78e175d` tree:
   **identical failure** — same assertion, same message, same line. Confirms the failure is not
   caused by this task's diff. `git stash pop` restored the working tree; `git status --short`
   confirmed all 8 files were back as modified.
3. Root cause of the assertion itself: `check-renderer-i18n.mjs:155` does
   `appMain.indexOf('trayHelper.init(mainWindowHelper)')`, a literal substring search against
   `src/main/app.main.ts`. That exact call shape no longer exists (see Finding 1: it was replaced by
   `trayHelper.init({ show: () => {...} })` in commit `c67ac21`, not `6caec1a` as the task doc
   claims), so `trayCreateIndex` is `-1`, making `trayCreateIndex > homeCreateIndex` false at line
   172.
4. Reading the full check script (`scripts/renderer-i18n/check-renderer-i18n.mjs`, all 480 lines):
   it crashes on an app-startup-ordering assertion *before* reaching any of its i18n-content
   assertions (lines 89-104, 106-123 — the only ones that inspect `en.ts`/`zh.ts` content at all, and
   neither checks the `eyesOnAgents.actions` namespace or any general key-parity rule). There is no
   assertion anywhere in this script that would exercise the new `openInIterm2` key, so its crash
   cannot be masking a real defect in this task's i18n change. Separately,
   `scripts/eyes-on-agents/tsconfig.ui.json` includes `src/renderer/common/i18n/**/*`, and `zh.ts` is
   declared `export const zh: typeof en = {...}` — so `yarn typecheck:eyes-on-agents:ui` (re-run
   clean, see below) already structurally enforces that every key in `en.ts` (including the new
   `eyesOnAgents.actions.openInIterm2`) has a matching key in `zh.ts`. The i18n-check failure is
   confirmed pre-existing, confirmed unrelated to this task's content, and confirmed not masking any
   reachable-but-untested i18n defect. **Non-blocking** (with Finding 1's commit-citation correction
   still recommended).

## Priority investigation 2 — stale layout-doc visibility claim

See Finding 2 above for the full analysis, quotes, line numbers, and recommendation (patch as an
immediate small follow-up; do not block 083 on it).

## Standard checks

1. **Required behavior match** — confirmed exactly:
   - `canOpenThread` (`ThreadCard.vue:186-187`) and `openLabel` (`ThreadCard.vue:203-204`, matching
     the ~190-192 the task doc estimates) are present only as unchanged context lines in
     `git diff HEAD -- .../ThreadCard.vue` — no `-`/`+` touches either definition. Byte-for-byte
     unchanged, confirmed by diff, not by general impression.
   - `canOpenInIterm2 = computed(() => props.thread.iterm2SessionId !== null)` at
     `ThreadCard.vue:188`, immediately after `canOpenThread` — matches the required behavior exactly.
   - New `<a-doption v-if="canOpenInIterm2">` (`ThreadCard.vue:83-92`) inserted directly after the
     existing provider-named Open item and before the read-state toggle, `:disabled` bound to the
     same `eyesOnAgentsStore.openingSessionKeys.has(thread.sessionKey)` expression the primary Open
     item uses — correct defense-in-depth split, matches the Copy-session-path precedent.
   - `handleOpenInIterm2` (`ThreadCard.vue:231-233`):
     `await eyesOnAgentsStore.openThreadInIterm2(props.thread.sessionKey).catch(() => undefined);` —
     byte-for-byte the same idiom as `handleOpen`'s
     `await eyesOnAgentsStore.openThread(props.thread.sessionKey).catch(() => undefined);`.
   - `openThreadInIterm2` (`eyesOnAgents.store.ts:386-403`) diffed structurally against `openThread`
     (`eyesOnAgents.store.ts:367-384`, confirmed unchanged by the same `git diff` showing it only as
     context): identical in-flight guard (`openingSessionKeys.has`/add/delete via `finally`),
     identical `actionError` set + rethrow on failure, identical `applySnapshot` on success. The only
     substantive difference is the early-return guard condition
     (`thread.iterm2SessionId === null` vs. `thread.provider === 'claude' && thread.desktopSessionId
     === null`), which is correct given `iterm2SessionId` is Claude-only by construction. This is a
     genuine structural mirror, not merely superficial similarity.
   - i18n keys: `en.ts:644` `openInIterm2: 'Open in iTerm2'`, `zh.ts:631`
     `openInIterm2: '在 iTerm2 中打开'`, both placed immediately after `openInClaude` in both files,
     matching the `openInCodex`/`openInClaude` placement precedent exactly.
   - CLI-only row test (`thread-card-open-capability.test.mjs`, "a CLI-only Claude row exposes Open
     in iTerm2 without enabling the primary Open route"): asserts `card.hasAttribute('tabindex') ===
     false` (i.e. `canOpenThread` stays false), asserts Enter/dblclick dispatch produce no
     `store.calls.open`, and asserts the dropdown option list is exactly `['Open in iTerm2', 'Mark as
     unread', 'Copy session path']` (no primary Open item). This is a real DOM-level assertion, not a
     tautology.
   - Both-identity row test ("a row with both desktopSessionId and iterm2SessionId offers both open
     routes at once"): asserts `tabindex === '0'`, asserts dropdown option order is exactly `['Open
     in Claude (double click)', 'Open in iTerm2', 'Mark as unread', 'Copy session path']`, and asserts
     clicking "Open in iTerm2" only populates `calls.openIterm2`, never `calls.open`. Both cases from
     the task's Verification section are covered by real, non-trivial assertions.

2. **Out-of-scope files** — none. `git diff --stat HEAD` (reproduced above) touches only
   `ThreadCard.vue`, `eyesOnAgents.store.ts`, `en.ts`, `zh.ts`, two test files, and two doc files. No
   `.dao.ts`, `.service.ts`, `.handler.ts`, or migration file is present in the diff. Confirmed the
   backend surface this task calls (`openThreadInIterm2` on `EyesOnAgentsApi`,
   `src/shared/eyesOnAgents/eyesOnAgents.type.ts:536`; service impl at
   `src/main/eyesOnAgents/eyesOnAgents.service.ts:2266`; XPC registration at
   `src/main/xpc/eyesOnAgents.handler.ts:318`) already existed, committed, from task 082 — task 083
   correctly only calls it via the auto-generated `eyesOnAgentsEmitter` (`createXpcRendererEmitter<
   EyesOnAgentsApi>('EyesOnAgentsHandler')`), requiring no emitter-file edit since the typed interface
   already declared the method.

3. **Test meaningfulness** — read the actual new assertions in both test files (quoted diffs
   reviewed in full), not just test names. All three new tests in
   `thread-card-open-capability.test.mjs` assert on real rendered DOM (`tabindex` attribute presence/
   value, dropdown option text array equality including order, dispatched-event no-op behavior) and
   real store-call tracking arrays, not vacuous existence checks. The parametrized sweep (`for
   provider of ['codex','claude'] × desktopSessionId ∈ {null, present} × iterm2SessionId ∈ {null,
   present}`) asserts `canOpenThread`'s `tabindex` outcome equals `provider === 'codex' ||
   desktopSessionId !== null` regardless of `iterm2SessionId`, which is exactly the
   Verification-section requirement "canOpenThread is unaffected by iterm2SessionId in every
   combination". The new `focus-board-store.test.mjs` test exercises the real bundled
   `eyesOnAgents.store.ts` (not a stub) through a harness, and covers both the success call (exact
   `sessionKey`, no Desktop-route call) and the rethrow-then-swallow contract
   (`assert.rejects(...) ` on the raw call, then a second call wrapped in the literal
   `.catch(() => undefined)` pattern `handleOpenInIterm2` uses). This is the genuine store-level test
   the task's Verification section asked for, distinct from the fully-mocked component test.

4. **Verification commands re-run independently** (all on the current dirty working tree, after the
   stash/pop from investigation 1 restored it):
   - `yarn test:eyes-on-agents:ui` → **75 passed, 0 failed**. Matches the developer's report exactly.
   - `yarn typecheck:eyes-on-agents:ui` → **exit 0**, `vue-tsc --noEmit -p
     scripts/eyes-on-agents/tsconfig.ui.json --composite false`, no diagnostics printed.
   - `git diff --check` → **clean, no output**.
   - `yarn check:renderer-i18n` → **fails**, confirmed pre-existing/unrelated per Priority
     investigation 1 above; not a blocker.

5. **Code style** — arrow-const throughout (`canOpenInIterm2`, `handleOpenInIterm2` both arrow
   consts); no `forEach` introduced (grepped the diff — none present); static top-of-file import for
   `IconTerminal2` (`ThreadCard.vue:131`, alongside the other `@tabler/icons-vue` imports, no dynamic
   import); `i18nHelper.eyesOnAgents.actions.openInIterm2` used in the template exactly like every
   sibling label, no `$t()`/`useI18n()`; no `emit`-based pattern introduced (the new action is a
   direct store-method call, matching every other action in this file — `emit` is reserved for
   generic reusable components per this repo's house style, and `ThreadCard.vue` is a business
   component that already drives state via store calls, not emits). File suffix conventions
   (`.store.ts`, `.vue`) unchanged. Semicolons present on all new statements.

## Acceptance-criteria satisfaction (docs/features/eyes-on-agents-iterm2-open.md "Acceptance")

| # | Bullet | Satisfied? | Evidence |
|---|---|---|---|
| 1 | A Claude Code CLI session started inside iTerm2 becomes visible in Focus after its `SessionStart` Hook delivery commits, with no Claude Desktop matching required. | Yes | Task 081: `createClaudeHookEventV3` captures `ITERM_SESSION_ID` on `SessionStart` inside iTerm2 (`claudeHookBridge.contract.ts`), tested in `claude-hook-terminal-identity.test.mjs`. Task 082: `getSnapshot()` filter widened at `eyesOnAgents.service.ts:829-833` to admit `thread.iterm2SessionId !== null`; tested in `claude-iterm2-open.test.mjs` (CLI-only row w/ only `iterm2SessionId` included in Claude projection). |
| 2 | A CLI session started in Terminal.app, a plain shell, or predating this delivery gains no `iterm2SessionId` and remains subject to the existing Desktop-only visibility rule. | Yes | Task 081: `createClaudeHookEventV3` only reads the env var when `TERM_PROGRAM === 'iTerm.app'`; missing/other value yields the field-absent shape (never defaulted/invented), tested by `claude-hook-terminal-identity.test.mjs`'s "outside iTerm2" and "predates delivery" cases. |
| 3 | **Open in iTerm2** is offered only when `iterm2SessionId` is non-null and never replaces/hides **Open in Claude Desktop** when both are present. | Yes | Task 083: `canOpenInIterm2` (`ThreadCard.vue:188`) gates the new `a-doption`; the both-identity test in `thread-card-open-capability.test.mjs` asserts both `Open in Claude (double click)` and `Open in iTerm2` render together in the dropdown. |
| 4 | Opening via **Open in iTerm2** never calls the Codex/Claude-Desktop deep-link builder, and the existing Open path never reads `iterm2SessionId`. | Yes | Backend (082): `openThreadInIterm2` (`eyesOnAgents.service.ts:2266+`) builds only `buildEyesOnAgentsIterm2DeepLink`, never `buildEyesOnAgentsClaudeDesktopDeepLink`; `openThread`'s existing claude branch is byte-for-byte unchanged and still only reads `desktopSessionId`. Renderer (083): `handleOpen`/`openThread` diffed unchanged (no `iterm2SessionId` reference); `handleOpenInIterm2`/`openThreadInIterm2` diffed as new, calling only the iTerm2 route. Both-identity test asserts clicking one action never populates the other's call-tracking array. |
| 5 | A malformed `ITERM_SESSION_ID` is rejected at hook-payload parse time, producing no terminal identity — never a thrown Hook failure or broken deep link. | Yes | Task 081: `parseClaudeHookIterm2SessionId` is non-throwing, validated against `CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN`; malformed-value cases (wrong shape, too short, empty, `undefined`) covered in `claude-hook-terminal-identity.test.mjs`. |
| 6 | An existing V1/V2 offline outbox delivery parses/commits exactly as today; no migration rewrites persisted deliveries. | Yes | Task 081: `parseClaudeHookEvent` still accepts `schemaVersion` 1/2/3 with V1/V2 paths byte-for-byte unchanged; "V1/V2 fixtures still parsing unchanged" is an explicit test case in `claude-hook-terminal-identity.test.mjs`. No migration/rewrite code touches historical deliveries. |
| 7 | A restart preserves every previously captured `iterm2_session_id` exactly like `desktop_session_id`; an event without a terminal identity never clears a stored one. | Yes | Task 082: DAO COALESCE-preserve rule `thread.iterm2SessionId ?? row.iterm2_session_id ?? null` in `upsertClaudeInventory`, tested in both directions (no-identity event does not clear; new identity replaces) plus independence from `desktop_session_id`, in `repository.test.mjs`. |
| 8 | Repository, migration audit, core, bridge, UI-source, typecheck, and production build checks run without launching Electron windows. | Mostly — one pre-existing, unrelated caveat | All named check categories were run headlessly across 081/082/083 (`test:eyes-on-agents:repository`, `:core`, `:bridge`, `:claude`, `:ui`, `typecheck:eyes-on-agents:core`/`:ui`, `typecheck:sqlite-migrations`, migration-audit coverage in `repository.test.mjs`) with no Electron process/window launched, re-confirmed for 083's own tests/typecheck in this review. `yarn build` (electron-vite) has main+preload succeeding but the renderer step failing on an unrelated pre-existing `trench-io` plugin `ENOENT`, per task 082's own review (`eyes-on-agents-iterm2-backend-082-1.md:220`) — this predates task 081, is untouched by 083's renderer-only diff, and does not launch an Electron window either way. Not a new gap introduced by this task. |
| 9 | Manual, non-automatable verification (start a `claude` session in iTerm2, click **Open in iTerm2**, confirm focus). Owner-verified only, cannot run in CI. | Excluded, as specified | Correctly not attempted by any of the three tasks; task 083 explicitly notes it as owner-only manual verification, per its own Path/Verification sections. |

## Conclusion

**pass**

No finding in this review blocks closing task 083. Two non-blocking items are worth handling
promptly outside this task's own diff: (1) correct the task file's root-cause commit citation from
`6caec1a` to `c67ac21` (Finding 1), and (2) patch the three stale "Claude rows without a trusted
Desktop route do not render" sentences in `docs/integrations/eyes-on-agents-layout.md` (lines
363-364, 399-400, and 486) as a small immediate follow-up (Finding 2) rather than folding them into
083 or leaving them open indefinitely.
