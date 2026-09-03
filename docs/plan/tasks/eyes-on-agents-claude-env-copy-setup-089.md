---
id: eyes-on-agents-claude-env-copy-setup-089
scope: Add a per-environment "Copy setup command" action that puts a ready-to-paste CLAUDE_CONFIG_DIR shell wrapper on the clipboard
status: done
depends-on: [eyes-on-agents-claude-multi-env-renderer-088]
verify: focused EyesOnAgents UI-source/store and contract unit tests, Core strict typecheck, UI strict typecheck; no Electron
---

# EyesOnAgents Claude Environment Copy Setup Command

## Objective

The Connections drawer tells the user their `claude2` wrapper must set `CLAUDE_CONFIG_DIR` before
invoking `claude`, but makes them hand-write that shell plumbing from a sentence of prose. Give each
`mode: 'custom'` environment row a **Copy setup command** action that puts a ready-to-paste wrapper
on the clipboard, derived from that row's own label and directory.

## Context

- `docs/features/eyes-on-agents-claude-multi-environment.md` — the
  "Per-environment setup: copyable shell command and install probe" section is the exact contract,
  including the snippet's shape, the function-name derivation rules, and the no-logging constraint.
  Its Non-goals explicitly exclude writing the snippet into the user's shell profile and verifying
  the user's wrapper actually works.
- The existing **Copy `/reload-plugins`** action is the precedent to mirror end to end:
  `ClaudeObservationCard.vue`'s `handleCopyReloadCommand` → `eyesOnAgentsStore.copyClaudeReloadCommand`
  (`store/eyesOnAgents.store.ts:368`, via `runCommandAction`) → `eyesOnAgentsEmitter` →
  `EyesOnAgentsHandler.copyClaudeReloadCommand` (`src/main/xpc/eyesOnAgents.handler.ts:479`) →
  `EyesOnAgentsService.copyClaudeReloadCommand` (`eyesOnAgents.service.ts:3103`), which writes via
  the injected `writeClipboardText` dependency (`eyesOnAgents.handler.ts:271`). Reuse that
  dependency; do not import `electron`'s `clipboard` anywhere new.
- Task 088's `ADD_CLAUDE_ENVIRONMENT_KEY` / `busyClaudeEnvironmentIds` pattern is how per-row
  pending state is already expressed; the copied-confirmation pattern (`reloadCommandCopied` ref +
  `aria-live="polite"` label swap) is at `ClaudeObservationCard.vue:398,455`.

## Required behavior

- **Snippet builder lives in shared contract code, not in the Vue file or the service.** Add a pure
  function to `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` (the same module that already owns
  the deep-link builders) taking `{ label, configDirectory }` and returning the snippet string:

  ```sh
  # Bitterless: Claude environment "claude2"
  claude2() { CLAUDE_CONFIG_DIR='/Users/ral/.claude2' command claude "$@"; }
  ```

  Putting it in shared contract code is what makes it unit-testable without Electron and keeps one
  definition for both the renderer's preview (if any) and the main-process clipboard write.
- **Function-name derivation, exactly:** take the environment label, lowercase it, replace every
  character outside `[a-z0-9_]` with `_`, prefix `_` if the result starts with a digit, and fall
  back to `claude_env` if nothing usable remains (empty, or all-separator). Collapse runs of `_`
  rather than emitting `my___env`.
- **`command claude`, not `claude`.** A label of `claude` must produce a working, non-recursive
  wrapper. This is the single most important correctness detail in the snippet — a recursive shell
  function would hang the user's terminal. Cover it with a test.
- The comment line must carry the environment's **original** label (not the sanitized function
  name), so a label like `Claude 工作号` is still identifiable in the user's shell profile. Escape or
  strip anything that would break out of the `"` quoting in either the comment or the directory.
- **Renderer:** one `Copy setup command` button per environment row, placed with the row's other
  path actions (beside `Change directory`). Rendered **only** when the row has a non-empty `id`,
  `mode === 'custom'`, and a non-null `configuredDirectory` — the automatic environment needs no
  wrapper and has a `null` directory by definition. Use the existing per-row busy set for its
  loading state and mirror the `Copied` confirmation pattern (`aria-live="polite"`), keeping
  `size="mini"`.
- **Store + XPC:** add `copyClaudeEnvironmentSetupCommand(environmentId)` gated per row through
  task 088's `runClaudeEnvironmentAction(id, …)`, through the emitter to a new handler method,
  to a new `EyesOnAgentsService` method that resolves the id via the existing
  `claudeDirectoryConfig`/`resolveClaudeBridgeEnvironment` path (the same resolution task 088 added
  for the bridge methods), builds the snippet with the shared function, and writes it with
  `writeClipboardText`. Add the method to `EyesOnAgentsApi` and satisfy it on **both**
  `EyesOnAgentsHandler` and `EyesOnAgentsService` — task 088 established that both `implements` it,
  and omitting either produces a real `TS2416`.
- **Never log the snippet or the directory.** No `console.*`/logger call may receive the snippet,
  the `configDirectory`, or anything derived from them. If the resolution fails, the thrown/reported
  error must identify the environment by `id`/`label` only. This is the existing
  "no `configDirectory` in `main.log`" rule; the clipboard write is the only sanctioned egress.
- Requesting a copy for an unknown id, or for an environment with a `null` directory, must fail
  cleanly through the existing action-error surface — not write a malformed snippet, and not write
  a snippet with an empty or `undefined` path.
- i18n: add `copySetupCommand` (and reuse the existing `copied` confirmation copy if it already sits
  in a reachable block, otherwise add one) under `eyesOnAgents.claudeEnvironment.*` in **both**
  `en.ts` and `zh.ts`, keeping the two files' key order identical.

## Path

- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` (pure snippet builder)
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (one new `EyesOnAgentsApi` member)
- `src/main/eyesOnAgents/eyesOnAgents.service.ts` (one new method + its id→directory resolution)
- `src/main/xpc/eyesOnAgents.handler.ts` (one new handler method)
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts` (one new store action)
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/` — snippet-builder unit tests (name derivation incl. the `claude`
  recursion case, quoting, fallback) and a render test for the button's visibility rules
- `docs/integrations/eyes-on-agents-layout.md` (the environments row's action list gains this button)

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`
- Do **not** run Electron, packaged builds, Playwright, or any `test:e2e:*` suite.
- Two failures are already-logged pre-existing ones and are not this task's to fix: the
  deterministic `ui-source.test.mjs` bundle-id assertion, and the flaky
  `thread-card-open-capability.test.mjs` right-click test. Any third failure is this task's problem.
- Owner-only manual check: paste the copied snippet into a real shell, run the wrapper, and confirm
  `claude` starts against the intended `CLAUDE_CONFIG_DIR`.

## Implementation evidence

### The emitted snippet

For a `mode: 'custom'` environment labelled `claude2` with `configDirectory: '/Users/ral/.claude2'`,
`buildEyesOnAgentsClaudeEnvironmentSetupCommand` returns exactly (two lines, no trailing newline):

```sh
# Bitterless: Claude environment "claude2"
claude2() { CLAUDE_CONFIG_DIR='/Users/ral/.claude2' command claude "$@"; }
```

Asserted byte-for-byte by `scripts/eyes-on-agents/claude-environment-setup-command.test.mjs:91-100`.

### Per-file changes

> Line citations in this section were re-derived from the current files after the Review-1 follow-up
> below; earlier revisions of this doc cited pre-follow-up (and in four cases off-by-one) ranges.

- **`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:23-56`** — the task's module-level consts in
  the existing top-of-file const block (fallback name, the `[^a-z0-9_]+` substitution pattern, the
  `__+` collapse pattern, the leading-digit test, the reserved-name set, the comment blank/control
  fold, and the single-quote escape pair). **`:462-475`** —
  `deriveEyesOnAgentsClaudeEnvironmentFunctionName` (explanatory comment at `:460-461`),
  exported separately so the derivation rules are testable without building a snippet.
  **`:491-506`** (comment at `:477-490`) —
  `buildEyesOnAgentsClaudeEnvironmentSetupCommand({ label, configDirectory })`,
  the pure builder, placed with the existing deep-link builders as the task's Path directed. It
  throws `'Claude environment setup command requires a configured directory'` on an empty directory
  or one containing `\0`/`\r`/`\n` (reusing the file's existing `CONTROL_CHARACTER_PATTERN`), so no
  malformed, empty, or `undefined` path can ever reach the clipboard.
- **`src/shared/eyesOnAgents/eyesOnAgents.type.ts:629-633`** — one new `EyesOnAgentsApi` member,
  `copyClaudeEnvironmentSetupCommand(params: { id: string }): Promise<void>`, placed with the
  environment-CRUD members. **Shape decision:** required `{ id }` (the CRUD members' shape), not the
  bridge methods' optional `{ environmentId }` — a wrapper is always explicitly row-scoped, and an
  omitted id silently resolving to `environments[0]` would hand the user a snippet for the wrong
  environment. Both `implements`-ers were updated in the same change, so no `TS2416` (the trap task
  088 hit): the handler at `eyesOnAgents.handler.ts:565-569` (comment at `:562-564`) and the service at
  `eyesOnAgents.service.ts:3111-3132`. `typecheck:eyes-on-agents:core` passes with 0 errors, which
  is the proof.
- **`src/main/eyesOnAgents/eyesOnAgents.service.ts:27`** — the new builder added to the existing
  contract import block. **`:3111-3132`** — `copyClaudeEnvironmentSetupCommand`, placed directly
  after `copyClaudeReloadCommand`. It calls the pre-existing private
  `requireClaudeDirectoryConfig()` (throws `'Claude environment configuration is unavailable'` when
  the dependency was never injected), resolves the id through the pre-existing
  `resolveClaudeBridgeEnvironment(list, { environmentId: params.id })` helper (an unknown id throws
  `'Claude environment was not found'`), rejects a non-`custom` or `null`-directory environment with
  `` `Claude environment "${environment.label}" has no configured directory to wrap` ``, and writes
  the snippet through the injected `writeClipboardText` dependency. It is deliberately **not**
  wrapped in `runClaudeBridgeLifecycle` (unlike `copyClaudeReloadCommand`): it spawns no CLI work
  and touches no bridge state, so serializing it against bridge operations would add a gate for
  nothing.
- **`src/main/xpc/eyesOnAgents.handler.ts:565-569`** (comment at `:562-564`) — the XPC-registered handler method, validating
  the payload with the pre-existing `parseEyesOnAgentsClaudeEnvironmentIdParams` (so an absent,
  empty, or non-UUID id fails at the boundary) and delegating to the service. No new `electron`
  import: the single pre-existing `clipboard` import at line 1 and its one
  `writeClipboardText: (text) => clipboard.writeText(text)` injection at line 271 are unchanged.
- **`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:431-439`** —
  `copyClaudeEnvironmentSetupCommand(id)`. **Deviation, declared:** the task's Store+XPC bullet says
  "following `copyClaudeReloadCommand`'s `runCommandAction` shape" while its Renderer bullet says
  "use the existing per-row busy set for its loading state." Those two cannot both be satisfied
  literally — `runCommandAction` gates on the global `busyAction`, not on
  `busyClaudeEnvironmentIds`. I followed the Renderer bullet (the more specific instruction) and
  routed it through the existing `runClaudeEnvironmentAction(id, …)` gate, which keeps
  `runCommandAction`'s error contract (clear `actionError` on entry, set it and rethrow on failure)
  while gating per row. Cost of the choice: `runClaudeEnvironmentAction` refreshes the snapshot after
  the callback, so a clipboard write incurs one extra `getSnapshot()` round trip. I judged that
  cheaper than a third gate variant, and it also means a copy cannot race a rename/remove on the
  same row. Using the global `busyAction` instead would have disabled every other control on the
  card while copying.
- **`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue:125-134`** —
  the `Copy setup command` button, inside the existing `eyes-connection-card__directories-path`
  actions row, immediately after **Change directory** and before **Use automatic**/**Retry**, with
  `size="mini"`, the per-row `busyClaudeEnvironmentIds` loading/disabled bindings, a stable
  `name="eyesOnAgents__connections__claudeEnvironmentCopySetup"`, and its label inside
  `<span aria-live="polite">` (the same shape as the card-level Copy `/reload-plugins` button).
  **`:516`** — `setupCommandCopiedId` ref, declared with the other row-editing refs; it holds the id
  of the last successfully-copied row, so copying another row moves the confirmation instead of
  showing two. **`:569-578`** — `canCopySetupCommand` (`:569-573`: `id !== '' && mode === 'custom'
  && configuredDirectory !== null`) and `setupCommandCopyLabel` (`:574-578`), which swaps to the existing
  `claudeBridge.copied` copy. **`:663-670`** — `handleCopySetupCommand`, mirroring
  `handleCopyReloadCommand`'s try/catch confirmation exactly. No new `.less` was needed: the button
  reuses the row's existing path-actions container. No business logic lives in the `.vue` — the
  snippet is built in Main from shared code and the store owns the call.
- **`src/renderer/common/i18n/en.ts:797` / `zh.ts:784`** — one new key,
  `eyesOnAgents.claudeEnvironment.copySetupCommand` (`'Copy setup command'` / `'复制配置命令'`),
  inserted at the identical position in both files (immediately after `changeDirectory`). Verified
  by extracting both blocks' key lists programmatically: identical sets in identical order. The
  `copied` confirmation copy is **reused**, not duplicated — `eyesOnAgents.claudeBridge.copied`
  already exists in both locales and is reachable from this component, which the task's i18n bullet
  explicitly sanctions.
- **`docs/integrations/eyes-on-agents-layout.md:309-316`** — a new paragraph describing the action,
  its three-part visibility rule, the `Copied` confirmation, and the no-logging constraint;
  **`:342`** — the environments ASCII diagram gains a `[Copy setup command]` line on the `claude2`
  row (all box lines re-measured to the existing 74-column width); **`:366`** — one new
  row-state-table row for `custom + configured directory`.

### Quoting / escaping decision

The label and the directory land in two different contexts, so they get two different treatments.

- **Directory, inside `'…'`:** the path is emitted single-quoted, so `'` is the only character that
  needs escaping, in the standard close/escape/reopen form `'\''`. Inside single quotes bash and zsh
  both leave history expansion (`!`), parameter expansion, command substitution and backslash
  escapes inert, so `"`, `$`, `` ` ``, `\` and `!` are all emitted verbatim and there is no escape
  ordering to get wrong. A directory containing `\0`, `\r`, or `\n` is rejected rather than escaped
  — a newline inside the quoted value would still be shell-correct but would silently break the
  documented two-line snippet shape. **The builder's own guard is the only gate for those three
  characters**, not a second line of defence: `requireCanonicalClaudeConfigDirectory`
  (`src/main/eyesOnAgents/claudePath.resolver.ts:31`) rejects only `\0`, and
  `parseEyesOnAgentsClaudeConfigDir` (`eyesOnAgents.contract.ts:139-147`) rejects none of the three
  and is not on this path at all (it parses the hook-reported `claudeConfigDir`, not the configured
  environment directory). Behavior was and remains safe — the builder throws and nothing reaches the
  clipboard — only the earlier "already impossible upstream" claim was false. For every real
  canonicalized path nothing is escaped at all, so the snippet stays byte-identical to the design
  doc's "single-quoted and verbatim" wording. Round-trip proven by reversing the `'\''` form back to
  the input for twelve hostile paths (`claude-environment-setup-command.test.mjs:219-254`).
- **Label, inside the `#` comment:** a `#` comment runs to end of line, so the *only* character that
  can escape it is a newline. Every whitespace/C0-control/DEL run therefore folds to a single space
  and the result is trimmed; `"`, `$`, backtick, and `\` are left **verbatim** because they are
  inert after `#` and escaping them would make the comment less readable than the label the user
  typed. If the fold leaves nothing, the derived function name is used instead. This keeps the
  design doc's requirement that the comment carry the *original* label (so `Claude 工作号` stays
  identifiable) while making a two-line snippet structurally impossible to turn into three.
  Note: at the CRUD boundary `parseEyesOnAgentsClaudeEnvironmentLabel` already rejects `\0\r\n`, so
  this fold is a second line of defence for a persisted/legacy value, not the primary gate.

### Name derivation, including the edge cases

Order: `toLowerCase()` → replace every `[^a-z0-9_]+` run with `_` → collapse `__+` to `_` → fall
back to `claude_env` if the result is `''` or `'_'` → fall back to `claude_env` if the result is a
reserved name (`command` or a bash/zsh reserved word — see the Review-1 follow-up) → prefix `_` if
the result starts with a digit.

| label | function name |
|---|---|
| `claude2` | `claude2` |
| `claude` | `claude` (safe — the body calls `command claude`) |
| `command` | `claude_env` (reserved: would shadow `command` and recurse) |
| `if` / `while` / `time` / `coproc` … | `claude_env` (reserved shell word) |
| `command center` | `command_center` (only the exact name is reserved) |
| `builtin` | `builtin` (defines and invokes correctly in both shells) |
| `Claude Work` | `claude_work` |
| `My - Env` | `my_env` |
| `my___env` | `my_env` |
| `my_ _env` | `my_env` |
| `_leading` | `_leading` |
| `2nd account` | `_2nd_account` |
| `9` | `_9` |
| `Claude 工作号` | `claude_` |
| `工作号` (CJK-only) | `claude_env` |
| `!!!` (all punctuation) | `claude_env` |
| `___` | `claude_env` |
| `` / `   ` | `claude_env` |

**One judgement call worth flagging:** `Claude 工作号` yields `claude_`, with a trailing underscore.
Trimming leading/trailing `_` would produce the prettier `claude`, but neither the task's Required
behavior nor the feature doc lists a trim step, and trimming *leading* underscores would also
silently rewrite a legitimate `_leading` label. I followed the specified rules literally and pinned
the result in a test rather than adding an undocumented rule. Both `claude_` and `claude` are valid,
non-recursive shell function names, so this is cosmetic either way.

### New tests

`scripts/eyes-on-agents/claude-environment-setup-command.test.mjs` (new, 13 tests, all passing —
esbuild-loads the shared contract and `EyesOnAgentsService`, no Electron):

1. `the snippet matches the documented claude2 shape exactly`
2. `a label of "claude" produces a non-recursive `command claude` wrapper` — the contract's
   single most important correctness detail, asserted both as an exact string and as the negative
   `doesNotMatch(/\{ CLAUDE_CONFIG_DIR='[^']*' claude /)`
3. `a label deriving to `command` or a bash/zsh reserved word takes the fallback name` — all 22
   reserved names plus their uppercase forms, each asserted at both the derivation and the emitted
   snippet, plus the three negatives (`command center`, `if only`, `builtin`) that must be kept
4. `function names derive by lowercase, substitution, collapse, digit prefix, fallback` — the whole
   table above
5. `a CJK-only label falls back while a mixed label keeps its ASCII prefix` — also proves the comment
   carries the original label
6. `a shell-hostile directory cannot break out of its single quotes` — `"`/`$`/backtick/`\` all
   emitted verbatim inside `'…'`, and the assignment's frame intact on both ends
7. `every hostile directory round-trips through the single-quoted assignment` — twelve paths
   (`!`, one/two `'`, `$(id)`, a backtick, `${HOME}`, one/three trailing `\`, `"`, `;`), each
   asserted to leave no bare `'` in the emitted word and to reverse byte-for-byte to the input
8. `a shell-hostile label cannot break out of its `#` comment` — a label containing `"`, a newline,
   a tab, and `$(id)` still yields exactly two lines and no injected command line
9. `an empty or control-character directory throws instead of emitting a bad path`
10. `the service writes the resolved row snippet to the clipboard and logs nothing`
11. `an unknown id and a null-directory environment both fail without a clipboard write` — covers the
    unknown UUID, the automatic environment, and a `custom` environment whose directory was never
    chosen; asserts the clipboard stayed empty
12. `a missing claudeDirectoryConfig dependency fails by name, not by path`
13. `no source on the copy path logs the snippet, the directory, or reaches electron clipboard` — a
    source-level guard: the service method body matches no `console.`/`logger`/`logClaudeBridgeAction`
    /`log(`, interpolates `environment.label` and never `configDirectory`, writes only through
    `writeClipboardText`; the handler method validates the id and logs nothing; the service imports
    nothing `from 'electron'`; the handler still has exactly one `clipboard.*()` call site

`scripts/eyes-on-agents/claude-environment-render.test.mjs` (extended, 12 → 15 tests, all passing):

14. `Copy setup command renders only for a configured custom environment` — a three-row fixture
    (automatic, configured custom, custom-with-`null`-directory): the button appears only on the
    middle row, its click reaches the store with that row's id, the row then shows `Copied`, and the
    label sits inside an `aria-live="polite"` element
15. `the synthetic invalid-hydration row never offers Copy setup command` — an empty-id row with a
    directory still gets no button
16. `a failed copy leaves the row label unconfirmed` — a rejecting store call never renders `Copied`

The harness's `createStore` gained a `copySetup` call log and a `copyClaudeEnvironmentSetupCommand`
stub; nothing pre-existing in that file was modified.

### Verification

Exact final output line of each of the task's four commands (run from a clean state after the last
code edit):

- `yarn typecheck:eyes-on-agents:core` → `Done in 1.64s.` (0 errors)
- `yarn typecheck:eyes-on-agents:ui` → `Done in 2.13s.` (0 errors)
- `yarn test:eyes-on-agents:claude` → `Done in 11.19s.` — every group `fail 0`; the final
  `node --test` group reports `ℹ tests 40 / ℹ pass 40 / ℹ fail 0`, which includes this task's new
  tests (the file was added to that group — see the forced deviation below)
- `yarn test:eyes-on-agents:ui` → `info Visit https://yarnpkg.com/en/docs/cli/run for documentation
  about this command.` (yarn's non-zero-exit footer). Test totals in the delivery's 3 runs:
  `ℹ tests 102 / ℹ pass 100 / ℹ fail 2`. **`fail 2` is not this suite's baseline** — the baseline is
  *one* deterministic failure plus a flake that may or may not fire on a given run, so a correct run
  reports `fail 1` or `fail 2`:
  1. `ui-source.test.mjs` — `completed threads use one localized silent notification and bundled
     cross-platform tone` (the deterministic `app.main.ts` bundle-id assertion; always present,
     logged at `docs/plan/backlog.md:5-14`)
  2. `thread-card-open-capability.test.mjs` — `right-click opens the shared pointer menu and Archive
     remains Codex-only` (the known ~6/10 flake logged at `docs/plan/backlog.md:92-108`; it happened
     to fire in all 3 of the delivery's runs and did **not** fire in Review 1's run, which saw
     `fail 1`). Per that backlog entry, a run showing only the bundle-id failure is not evidence
     this one was fixed.
  **No third failure appeared**, and 102 = the 99 pre-existing tests plus this task's 3 new render
  tests. `claude-environment-render.test.mjs` passed 15/15 in every run.
- Extra, not required: `yarn test:eyes-on-agents:core` → `EyesOnAgents core tests passed` /
  `Done in 0.65s.`, run because this task changed the shared contract module that suite loads.
- `git diff --check` → clean, exit 0.
- i18n parity verified by reading `en.ts`/`zh.ts` directly (both `claudeEnvironment` blocks extracted
  and their key lists compared: identical sets, identical order), per the task's note that
  `yarn check:renderer-i18n` is broken for a pre-existing reason
  (`check-renderer-i18n.mjs:186`, a tray/Home startup-order assertion) and never reaches i18n
  content checks. That command was therefore not run.
- Electron, packaged builds, Playwright, and every `test:e2e:*` suite were **not** run, per the
  standing owner instruction. The real `claude` CLI was never invoked and no real `~/.claude` or
  `~/.claude2` was read or written — every test uses synthetic paths under `/Users/ral/.claude2`-style
  string fixtures only.
- The owner-only manual check (paste the snippet into a real shell and confirm `claude` starts
  against the intended `CLAUDE_CONFIG_DIR`) was **not** attempted.

### Deviations and gaps, stated plainly

1. **`package.json` was edited, and it is not in the task's declared Path.** Forced: the task's
   Verify section lists only `test:eyes-on-agents:claude` and `test:eyes-on-agents:ui`, so a new
   test file under `scripts/eyes-on-agents/` is not executed by either command unless it is wired
   into one of those chains. The edit is one filename appended to the final `node --test` group of
   `test:eyes-on-agents:claude` — the same mechanical step task 088 took for
   `claude-environment-render.test.mjs`. Nothing else in `package.json` was touched (in particular
   the `name` field the concurrent OnlyPreview session flips was left alone; `package.json` was
   unmodified in `git status` when I edited it).
2. **The store/renderer busy-gate conflict** described under `eyesOnAgents.store.ts` above — the
   contract's two bullets are mutually exclusive as written and I chose the per-row set.
3. **`ui-source.test.mjs` was not extended.** It is not in this task's Path, none of its existing
   assertions broke, and the new surface is covered behaviorally in
   `claude-environment-render.test.mjs` plus the source-level guard in the new claude test file
   (which is in Path). Flagging it because 088 did extend that file for comparable changes.
4. **No renderer-side preview of the snippet.** The task's builder bullet says the shared location
   keeps "one definition for both the renderer's preview (if any) and the main-process clipboard
   write" — there is no preview, so the renderer never imports the builder. The snippet is built in
   Main only, which also means it never crosses into a renderer where it could be logged.
5. `docs/features/eyes-on-agents-claude-multi-environment.md` was **not** modified. It already
   describes this task's contract correctly (it shows as modified in `git status` from before this
   task started — the 089/090 sections the orchestrator added), and nothing implemented here
   contradicts it.
6. Unrelated concurrent OnlyPreview work in the tree (`src/main/onlypreview/**`,
   `src/renderer/onlypreview/**`, `src/shared/onlypreview/onlyPreview.types.ts`,
   `tests/onlypreview/**`, `docs/features/onlypreview-alert-dialogs.md`,
   `docs/plan/tasks/onlypreview-alert-dialogs-120.md`) was left untouched.

### Contract defect corrected during delivery

This task's original "Store + XPC" bullet said to follow `copyClaudeReloadCommand`'s
`runCommandAction` shape while its "Renderer" bullet said to use the existing per-row busy set.
Those are mutually exclusive: `runCommandAction` gates on the single global `busyAction`, so it
cannot drive `busyClaudeEnvironmentIds`. The delivery correctly followed the per-row horn via task
088's `runClaudeEnvironmentAction(id, …)` — which keeps `runCommandAction`'s error contract while
scoping the pending state to one row, and prevents a copy from racing a rename/remove on the same
row. The bullet above has been corrected to state the per-row requirement only. The cost the
delivery flagged is real and accepted: `runClaudeEnvironmentAction` performs one extra
`getSnapshot()` after the clipboard write, which is cheaper than introducing a third action-gate
variant.

### Review-1 follow-up

Applied from `docs/plan/reviews/eyes-on-agents-claude-env-copy-setup-089-1.md` (#P3-1, #P3-2, and
its four INACCURATE items). The review's remaining P3s (#P3-3 derived-name collisions, #P3-4 stale
`Copied`, #P3-5 post-write snapshot error attribution, #P3-6 zsh `INTERACTIVE_COMMENTS`, #P3-7
error-message wording, #P3-0 `package.json` scope) were **not** in this follow-up's scope and are
unchanged. `status:` was not touched.

#### 1. Reserved-name guard (#P3-1)

`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:42-46` adds
`CLAUDE_ENVIRONMENT_FUNCTION_NAME_RESERVED`; `:468-473` applies it inside
`deriveEyesOnAgentsClaudeEnvironmentFunctionName`, after the sanitize/collapse/empty steps and
before the leading-digit prefix (a `_`-prefixed name can never be reserved, so the order is free).

**Fallback choice: the existing `claude_env`, not `<name>_env`.** One documented catch-all keeps one
name shape and one collision surface. `<name>_env` would *add* a collision class — a label of
`command env` already derives to `command_env` — so it trades a loud, already-documented
duplicate-name case for a new silent one, for no gain.

**Membership rule: `command`, plus the union of bash's and zsh's reserved-word tables restricted to
`[a-z0-9_]`.** Nothing was added on suspicion. Every candidate was probed *as the raw name* — i.e.
what the derivation would have produced **before** this guard — as `NAME() { :; }` under
`bash -n`/`zsh -n` **and** as define-and-call against the stub `claude`, because several names parse
fine and only break at the call site:

| name(s) | why reserved | observed with that raw name |
|---|---|---|
| `command` | regular builtin, shadowed by the wrapper → infinite recursion | bash `rc=124`, SIGKILLed after 5s; zsh `command: maximum nested function level reached; increase FUNCNEST?` |
| `if` `then` `else` `elif` `fi` `case` `esac` `for` `do` `done` `select` | reserved word in both shells | `bash -n` rc=2 **and** `zsh -n` rc=1, syntax/parse error |
| `while` `until` | bash reserved; zsh defines it, but the call is parsed as the loop keyword | `bash -n` rc=2; zsh define-and-call `rc=124`, **infinite loop** |
| `time` | bash reserved; zsh defines it, but the call is parsed as the timing keyword | `bash -n` rc=2; zsh call `command not found: --probe` — the wrapper never runs |
| `function` | bash reserved; zsh defines it, but the call loses the arguments | `bash -n` rc=2; zsh call `STUB-SAW:[…] ARGS:[]` (the user's `--probe` dropped) |
| `in` | bash reserved (zsh handles it fine) | `bash -n` rc=2 |
| `repeat` `foreach` `end` | zsh reserved (bash handles all three fine) | `zsh -n` rc=1, parse error |
| `coproc` `nocorrect` | both shells *define* them; zsh parses the name as a reserved word at the **call** site | `bash -n`/`zsh -n` rc=0; zsh call `command not found: --probe` / `ARGS:[]` — arguments lost |

Deliberately **excluded** as unreachable, not padded in: `!`, `{`, `}`, `[[`, `]]` — every one
collapses to `_` under `[^a-z0-9_]+ → _` and can only ever produce the `claude_env` fallback anyway.
Also excluded: `builtin`, which defines *and* invokes correctly in both shells (`STUB-SAW` exact,
`ARGS:[--probe]`) and is not referenced by the wrapper body.

Pinned by `claude-environment-setup-command.test.mjs:121-155` (all 22 names, their uppercase forms,
the emitted snippet for each, and the three negatives `command center` → `command_center`,
`if only` → `if_only`, `builtin` → `builtin`). Documented at
`docs/features/eyes-on-agents-claude-multi-environment.md:471-481`.

#### 2. Single-quoted directory (#P3-2)

`eyesOnAgents.contract.ts:50-56` replaces the old `CLAUDE_ENVIRONMENT_DOUBLE_QUOTE_UNSAFE_PATTERN`
(``/["$`\\]/gu``) with `CLAUDE_ENVIRONMENT_SINGLE_QUOTE_PATTERN` (`/'/gu`) plus
`CLAUDE_ENVIRONMENT_SINGLE_QUOTE_ESCAPE` (`'\''`); `:502-503` applies it and `:505` emits
`CLAUDE_CONFIG_DIR='…'`. The four-character backslash escape is gone — inside `'…'` both shells
leave history expansion, parameter expansion, command substitution and backslash escapes inert, so
`'` is the only character left to handle. `\0`/`\r`/`\n` are still rejected at `:495-497`.

New emitted snippet for `claude2` / `/Users/ral/.claude2` (two lines, no trailing newline):

```sh
# Bitterless: Claude environment "claude2"
claude2() { CLAUDE_CONFIG_DIR='/Users/ral/.claude2' command claude "$@"; }
```

Docs updated to match: `docs/features/eyes-on-agents-claude-multi-environment.md:463` (example) and
`:482-488` (the "single-quoted and verbatim" prose plus the one-line reason);
`docs/integrations/eyes-on-agents-layout.md:312`. Tests updated to assert single-quote output,
including a new round-trip case for an embedded `'` and one for an embedded `!`
(`claude-environment-setup-command.test.mjs:219-254`).

#### 3. Empirical shell probes

Real `eyesOnAgents.contract.ts` bundled with esbuild into a disposable `mktemp -d` sandbox, a
**stub** `claude` on `PATH` echoing `CLAUDE_CONFIG_DIR`, and a perl `alarm`+`SIGKILL` 5-second hard
timeout (macOS has no `timeout`) so a regression cannot hang the run. No real `claude` CLI, no
`~/.claude`, no `~/.claude2`.

```
### derived function names (real built contract)
baseline       fn=claude2    dir="/Users/ral/.claude2"
label_claude   fn=claude     dir="<SB>/cfg-claude"
label_command  fn=claude_env dir="<SB>/cfg-command"
label_if       fn=claude_env dir="<SB>/cfg-if"
label_while    fn=claude_env dir="<SB>/cfg-while"
label_time     fn=claude_env dir="<SB>/cfg-time"      # label 'TIME' — case folds into the guard
label_coproc   fn=claude_env dir="<SB>/cfg-coproc"
dir_bang       fn=bang       dir="<SB>/a!b"
dir_quote      fn=quote      dir="<SB>/a'b"
dir_dollarpar  fn=dollarpar  dir="<SB>/a$(touch <SB>/PWNED)b"
dir_backtick   fn=backtick   dir="<SB>/a`touch <SB>/PWNED`b"
dir_bracevar   fn=bracevar   dir="<SB>/${HOME}b"
dir_trailbs    fn=trailbs    dir="<SB>/a\"
dir_dquote     fn=dquote     dir="<SB>/a\"b"
dir_semi       fn=semi       dir="<SB>/a;touch <SB>/PWNED;b"

### bash -n / zsh -n on every emitted snippet + define-and-call vs stub claude
baseline       bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
label_claude   bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
label_command  bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact   # was: bash TIMEOUT / zsh FUNCNEST
label_if       bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
label_while    bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
label_time     bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
label_coproc   bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
dir_bang       bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
dir_quote      bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
dir_dollarpar  bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
dir_backtick   bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
dir_bracevar   bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
dir_trailbs    bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
dir_dquote     bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact
dir_semi       bash-n=0 zsh-n=0 | bash=OK-exact zsh=OK-exact

canary absent: no injection
```

`OK-exact` = the stub's observed `CLAUDE_CONFIG_DIR` is byte-identical to the builder's input.

Interactive-prompt paste (`bash --norc -i` and `zsh -f -i`, history expansion live), the failure
mode #P3-2 reported — old double-quoted form vs the shipped single-quoted form, same `!` path:

```
OLD  bash: !b": event not found        → bash: bang: command not found   (function never defined)
OLD  zsh:  event not found: b          → zsh: command not found: bang    (function never defined)
NEW  bash --norc -i  rc=0  STUB-SAW:[<SB>/a!b]
NEW  zsh  -f -i      rc=0  STUB-SAW:[<SB>/a!b]
```

Re-run at an interactive prompt for `baseline`, `label_command`, `dir_bang`, `dir_quote`,
`dir_dollarpar`, `dir_backtick`, `dir_bracevar`, `dir_trailbs`: **all `OK exact` in both shells.**
(`zsh -f` is required to bypass Ral's own `CORRECT_ALL`, which otherwise prompts a spelling
correction on the stub's `--probe` argument. Unrelated to the snippet. The `#` comment line still
errors at a default-configured interactive zsh prompt — that is #P3-6, untouched.)

#### 4. Inaccurate claims and citations corrected

- **`!` "only expands in interactive bash"** — the whole comment is gone; `eyesOnAgents.contract.ts:50-54`
  now states why single quotes are used, and notes `!` is inert inside them in both shells.
- **"`command` bypasses function lookup, so the wrapper cannot recurse"** — restated as "skips
  function lookup *for the name it is given*, and is itself a shadowable regular builtin, so this
  holds only while the wrapper is not named `command`" at `eyesOnAgents.contract.ts:483-487`,
  `docs/features/eyes-on-agents-claude-multi-environment.md:468-470`, and the test-2 comment at
  `claude-environment-setup-command.test.mjs:112-116`.
- **"already impossible upstream"** for `\0`/`\r`/`\n` — corrected in "Quoting / escaping decision"
  above. Verified by reading both functions: `requireCanonicalClaudeConfigDirectory`
  (`src/main/eyesOnAgents/claudePath.resolver.ts:30-45`) tests only `path.includes('\0')` at `:31`,
  and `parseEyesOnAgentsClaudeConfigDir` (`eyesOnAgents.contract.ts:139-147`) checks only
  non-string / empty / non-absolute — it rejects none of the three, and it parses the hook-reported
  `claudeConfigDir`, not the configured environment directory, so it is not on this path. The
  builder's guard is the sole gate. Shipped behavior was and remains safe.
- **Four imprecise `file:line` citations**, re-derived from the current files rather than from either
  document: `docs/integrations/eyes-on-agents-layout.md:309-316` (was `309-319`; `317` is blank and
  `318-319` are pre-existing text), `eyesOnAgents.handler.ts:565-569` (was `562-570`; `562-564` is
  the comment), `ClaudeObservationCard.vue:569-578` (was `569-577`; `setupCommandCopyLabel` ends at
  `578`), and the contract's builder, now `:491-506` with its comment at `:477-490` (was `451-476`).
  Every other contract citation in this doc was also re-derived, since this follow-up shifted them.

#### 5. UI-suite baseline (review's "not reproducible as stated")

Corrected in "Verification" above: `fail 2` is **not** this suite's baseline. The baseline is one
deterministic `ui-source.test.mjs` bundle-id failure plus a ~6/10 flake, so `fail 1` and `fail 2`
are both correct outcomes.

#### 6. Verification of this follow-up

Final line of each of the task's four commands, run after the last edit:

- `yarn typecheck:eyes-on-agents:core` → `Done in 3.38s.` (0 errors)
- `yarn typecheck:eyes-on-agents:ui` → `Done in 2.46s.` (0 errors)
- `yarn test:eyes-on-agents:claude` → `Done in 11.54s.` — every group `fail 0`; the final
  `node --test` group is now `ℹ tests 42 / ℹ pass 42 / ℹ fail 0` (40 + the 2 tests added here)
- `yarn test:eyes-on-agents:ui` → `ℹ tests 102 / ℹ pass 101 / ℹ fail 1` on **both** of two runs —
  only the deterministic `ui-source.test.mjs` bundle-id failure; the right-click flake did not fire.
  No third failure, nothing traceable to these edits.
- Extra: `yarn test:eyes-on-agents:core` → `EyesOnAgents core tests passed` / `Done in 0.67s.`;
  `git diff --check` clean, exit 0.
- Electron, packaged builds, Playwright and every `test:e2e:*` suite were **not** run. The real
  `claude` CLI was never invoked; no real `~/.claude` or `~/.claude2` was read or written.
- Pre-existing, not introduced here: `yarn eslint src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
  reports one `no-control-regex` error on `CLAUDE_ENVIRONMENT_COMMENT_BLANK_PATTERN` (`:49`), a line
  this task added in its original delivery. Left alone — eslint is not in the Verify list and fixing
  it would change the comment-fold behavior.

## Review

[Independent review 1](../reviews/eyes-on-agents-claude-env-copy-setup-089-1.md) passed with no
blocking findings. It did the one thing that actually matters for this task — it treated the emitted
string as shell the user executes, built the real contract module with esbuild, emitted 19 hostile
snippets, and ran `bash -n`/`zsh -n` plus define-and-call against a stub `claude` in a disposable
sandbox. It confirmed the escaping is a single-pass replace (so the ordering trap that breaks naive
sequential escaping cannot occur), that a trailing odd number of backslashes cannot escape the
closing quote, that label newline folding covers U+2028/U+2029, and that the test pinning the
`claude`-label recursion case uses a negative regex that genuinely matches the bad output rather
than a vacuous one.

Two of its seven P3 findings were fixed before close-out rather than logged, because both were
paths to harm this task's own contract names as critical:

- **A label deriving to exactly `command` produced an infinitely recursive wrapper** — the review
  empirically hung bash (SIGKILL after 5s) and made zsh abort with "maximum nested function level
  reached". The contract had called out the `claude` label but not this one. Fixed with an explicit
  reserved-name guard; probing every candidate *as an invoked function* (not just `-n` parsed) also
  caught `while`/`until` looping forever in zsh, `function` silently dropping the user's arguments,
  and `coproc`/`nocorrect` parsing fine but misbehaving at the call site.
- **A directory containing `!` produced a snippet unpasteable at an interactive prompt in both
  shells** (history expansion applies inside double quotes). Fixed by switching the directory to
  **single** quotes, which makes `!`, `$`, backtick, `\` and `"` all inert and collapses the escape
  set to the single `'\''` case — strictly safer and simpler than the four-character double-quote
  escape it replaces. The design doc's snippet example and prose were updated to match.

The review also caught four inaccurate statements in this task's own evidence, all corrected: a
false defence-in-depth claim that upstream already rejects `\0`/`\r`/`\n` (verified: only `\0`, and
only in `claudePath.resolver.ts`; the builder's guard is the sole gate — behavior was always safe,
the claim was not), an over-general "`command` bypasses function lookup so the wrapper cannot
recurse" (true for a `claude` function, false for a `command` one — exactly the bug above), a
wrong claim about `!` expanding only in interactive bash, and four imprecise `file:line` citations.
It also corrected the UI-suite baseline: `fail 2` is not this suite's fixed baseline — one failure
is deterministic and the second is a logged ~6/10 flake, so both `fail 1` and `fail 2` are normal.

Two hygiene defects introduced by this task were fixed during close-out, outside the review's list:

- The new `CLAUDE_ENVIRONMENT_COMMENT_BLANK_PATTERN` regex made this file the repo's only
  `eslint` **error** (`no-control-regex`). Matching control characters is the deliberate intent, so
  it now carries a single-line targeted `eslint-disable-next-line` with a reason. (The first attempt
  used a two-line comment, which silently does not work — `eslint-disable-next-line` covers only the
  line immediately following the directive comment.) The file's 37 remaining `prettier/prettier`
  warnings are pre-existing and non-failing; 6 fall in this task's added lines and were left alone
  because `--fix` would reformat 31 unrelated lines and because the surrounding file does not follow
  prettier's exploded style.
- The review file itself was written with **literal** control bytes (3×`\0`, 3×`\x1f`, 1×`\x7f`) from
  documenting hostile inputs, which made `file` report it as `data` and caused `git grep`/`grep` to
  treat it as binary and silently return nothing. The bytes are now escaped as text, so the review
  is greppable.

Five P3 findings remain open and are logged in `docs/plan/backlog.md`: derived-name collisions,
the never-resetting `Copied` confirmation, a post-write `getSnapshot()` failure reporting a
successful copy as failed, zsh's default `INTERACTIVE_COMMENTS` rejecting the `#` line at an
interactive prompt, and the builder's control-character guard being the sole gate.
