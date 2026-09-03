# Review 1 — eyes-on-agents-claude-env-copy-setup-089

Reviewer: independent review pass (no source edits, no Electron / packaged / Playwright / E2E run,
no real `claude` CLI, no read or write of `~/.claude` or `~/.claude2`).

**Verdict: `passed`** — with 7 non-blocking (P3) findings and 4 corrections to the task's own
Implementation-evidence text. No blocking defect found.

The escaping work — the part that actually matters, because the emitted string is shell the user
executes — is empirically airtight. Every hostile directory I could construct round-trips
byte-for-byte through both `bash` and `zsh`, and no injection canary ever fired. The P3s below are
real but each requires an implausible label or an unusual path, and every one fails loudly rather
than silently.

## Review method

Changes are uncommitted in the working tree, read via `git diff` / `git status`. The tree also
carries a large amount of unrelated concurrent OnlyPreview work
(`src/main/onlypreview/**`, `src/renderer/onlypreview/**`, `src/shared/onlypreview/onlyPreview.types.ts`,
`tests/onlypreview/**`, `docs/features/onlypreview-alert-dialogs.md`,
`docs/plan/tasks/onlypreview-alert-dialogs-120.md`, `docs/issues/eyes-on-agents-omni-search-shortcut-focus.md`,
and `docs/INDEX.md`'s omni-search-shortcut registration line) — all ignored, not touched, not
staged, not reverted.

Files changed by this task, all inside its declared Path except `package.json`:

```
src/shared/eyesOnAgents/eyesOnAgents.contract.ts
src/shared/eyesOnAgents/eyesOnAgents.type.ts
src/main/eyesOnAgents/eyesOnAgents.service.ts
src/main/xpc/eyesOnAgents.handler.ts
src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts
src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue
src/renderer/common/i18n/en.ts, src/renderer/common/i18n/zh.ts
scripts/eyes-on-agents/claude-environment-setup-command.test.mjs   (new)
scripts/eyes-on-agents/claude-environment-render.test.mjs
docs/integrations/eyes-on-agents-layout.md
package.json                                                        (outside Path — see #P3-0)
```

`docs/features/eyes-on-agents-claude-multi-environment.md` is also modified (85 insertions), but the
diff is entirely the orchestrator-authored design sections for **both** task 089 **and** task 090
(the per-environment install probe, which 089 did not implement) plus the matching Non-goals and
Acceptance bullets. An implementer of 089 would not have written 090's design, so the delivery's
account that this predates the task is corroborated by its content. Not attributed to 089.

Beyond reading the diff, correctness of the emitted shell was verified **empirically** by building
the real `eyesOnAgents.contract.ts` with esbuild, emitting snippets for 19 hostile inputs, and
running `bash -n` / `zsh -n` plus a define-and-call probe against a **stub** `claude` inside a
disposable `mktemp -d` sandbox. Commands and output are reproduced below.

## Verification I ran myself

| command | result |
|---|---|
| `yarn typecheck:eyes-on-agents:core` | `$ tsc -p scripts/eyes-on-agents/tsconfig.strict.json` → `Done in 3.19s.`, exit 0, 0 errors |
| `yarn typecheck:eyes-on-agents:ui` | `$ vue-tsc --noEmit -p scripts/eyes-on-agents/tsconfig.ui.json --composite false` → `Done in 2.21s.`, exit 0, 0 errors |
| `yarn test:eyes-on-agents:claude` | exit 0; every group `fail 0`; final `node --test` group `ℹ tests 40 / ℹ pass 40 / ℹ fail 0`; `Done in 13.56s.` |
| `yarn test:eyes-on-agents:ui` | exit 1; `ℹ tests 102 / ℹ pass 101 / ℹ fail 1` |
| `yarn test:eyes-on-agents:core` (extra, shared contract changed) | `EyesOnAgents core tests passed` / `Done in 2.54s.` |
| `git diff --check` | clean, exit 0 |

`yarn test:eyes-on-agents:ui`'s single failure is
`✖ completed threads use one localized silent notification and bundled cross-platform tone` in
`ui-source.test.mjs` — the `ERR_ASSERTION` on
`expected: /import\.meta\.env\.VITE_ENV === 'dev'\s*\?\s*'io\.bitterless\.desktop_dev'\s*:\s*'io\.bitterless\.desktop'/`,
i.e. exactly the pre-existing bundle-id entry already logged in `docs/plan/backlog.md:5-14`.
`thread-card-open-capability.test.mjs`'s right-click test **passed** in my run — consistent with the
backlog's documented ~6/10 flake (`backlog.md:92-108`), so my run shows 1 failure where the delivery
reported 2. **No third failure, and nothing traceable to this task.** All three new render tests
passed:

```
35:✔ Copy setup command renders only for a configured custom environment (8.125875ms)
36:✔ the synthetic invalid-hydration row never offers Copy setup command (4.18625ms)
38:✔ a failed copy leaves the row label unconfirmed (9.142958ms)
```

`yarn check:renderer-i18n` was **not** run (broken for the pre-existing reason logged at
`backlog.md:122-128`; i18n verified by reading the files, see #9 below).

## Priority checks

### 1. Shell injection and quoting — CONFIRMED correct, empirically

The escape is a **single-pass** global replace, which is the reason the ordering trap the review
brief warned about does not exist here (`eyesOnAgents.contract.ts:472-473`):

```ts
const directory = params.configDirectory
  .replace(CLAUDE_ENVIRONMENT_DOUBLE_QUOTE_UNSAFE_PATTERN, '\\$&');
```

with `CLAUDE_ENVIRONMENT_DOUBLE_QUOTE_UNSAFE_PATTERN = /["$`\\]/gu`
(`eyesOnAgents.contract.ts:35`). Because `String.prototype.replace` does not re-scan its own
inserted text, each of `"`, `$`, `` ` ``, `\` is escaped exactly once regardless of adjacency —
there is no sequential-replace double/under-escape window. Verified against the specific adversarial
case named in the brief (a literal backslash immediately followed by a quote) and against a trailing
odd number of backslashes.

Probe (real contract code, disposable sandbox `$SB`, stub `claude` on `PATH`):

```
$ bash -n / zsh -n on all 13 emitted snippets
backtick.sh        bash=0  | zsh=0
bang.sh            bash=0  | zsh=0
baseline.sh        bash=0  | zsh=0
brace_var.sh       bash=0  | zsh=0
bs_quote.sh        bash=0  | zsh=0
dollar_paren.sh    bash=0  | zsh=0
label_claude.sh    bash=0  | zsh=0
label_command.sh   bash=0  | zsh=0
label_newline.sh   bash=0  | zsh=0
semicolon.sh       bash=0  | zsh=0
single_quote.sh    bash=0  | zsh=0
trailing_3bs.sh    bash=0  | zsh=0
trailing_bs.sh     bash=0  | zsh=0
```

```
$ define + call, compare the CLAUDE_CONFIG_DIR the stub observed against the exact input
baseline       bash  OK exact      baseline       zsh   OK exact
label_claude   bash  OK exact      label_claude   zsh   OK exact
dollar_paren   bash  OK exact      dollar_paren   zsh   OK exact      # /a$(touch $SB/PWNED)x
backtick       bash  OK exact      backtick       zsh   OK exact      # /a`touch $SB/PWNED`y
bs_quote       bash  OK exact      bs_quote       zsh   OK exact      # /a\"b
trailing_bs    bash  OK exact      trailing_bs    zsh   OK exact      # /a\
trailing_3bs   bash  OK exact      trailing_3bs   zsh   OK exact      # /a\\\
brace_var      bash  OK exact      brace_var      zsh   OK exact      # /${HOME}z
semicolon      bash  OK exact      semicolon      zsh   OK exact      # /a;touch $SB/PWNED;b
single_quote   bash  OK exact      single_quote   zsh   OK exact      # /a'b
bang           bash  OK exact      bang           zsh   OK exact      # /a!b  (see #P3-2)
label_newline  bash  OK exact      label_newline  zsh   OK exact
label_command  bash  TIMEOUT/HANG  label_command  zsh   'command: maximum nested function level reached; increase FUNCNEST?'   (see #P3-1)

canary absent: no injection
```

Concretely, for `configDirectory = '/tmp/a"b$HOME`id`c\d'` the emitted bytes are

```
weird() { CLAUDE_CONFIG_DIR="/tmp/a\"b\$HOME\`id\`c\\d" command claude "$@"; }
```

and both shells hand the stub back `/tmp/a"b$HOME`id`c\d` verbatim. A trailing `\` emits `\\`, so
the closing `"` is never escaped: `"$SB/a\\"` → shell sees `$SB/a\`. Three trailing backslashes emit
six. **The `\` escaping is consistent with the others and cannot escape the closing quote.**

**Label, inside the `#` comment.** `CLAUDE_ENVIRONMENT_COMMENT_BLANK_PATTERN = /[\s\x00-\x1f\x7f]+/gu`
(`eyesOnAgents.contract.ts:32`) folds every run to one space, then `.trim()`, falling back to the
derived function name (`:469-471`). Newline handling is airtight:

- `\n` (U+000A) and `\r` (U+000D) are matched **twice over** (both by `\s` and by `\x00-\x1f`).
- The JS-regex-only "line terminators" the brief flagged, U+2028 / U+2029, **are** matched — JS `\s`
  includes both. Verified: label `'a b'` → comment `"a b"`, 2 lines.
- U+0085 (C1 NEL) is *not* folded (it is outside both `\s` and `\x00-\x1f`) and survives
  verbatim — hexdump of the emitted comment line: `2022 61c2 8562 220a` (`"a<c2 85>b"`). Harmless:
  U+0085 is not a line terminator in bash or zsh; the snippet stays 2 lines, `bash -n`/`zsh -n` pass,
  and the wrapper works. Not reported as a finding — the code comment claims only whitespace/C0/DEL
  folding, which is exactly what it does.
- Adversarial label `'ev"il\n rm -rf /\t$(id)'` → `# Bitterless: Claude environment "ev"il rm -rf / $(id)"`,
  exactly 2 lines, no injected command line, and the wrapper runs normally.

`"`, `$`, `` ` ``, `\` are deliberately left verbatim in the comment; correct — they are inert after
`#`. I found no input that turns the 2-line snippet into 3, and no input that executes anything
unintended.

### 2. The `claude` recursion case — CONFIRMED, and the pinning test is real

`eyesOnAgents.contract.ts:475` emits `command claude "$@"` unconditionally, so label `claude` yields

```
claude() { CLAUDE_CONFIG_DIR="$SB/.claude-work" command claude "$@"; }
```

Probe: `label_claude bash OK exact` / `label_claude zsh OK exact` — defines, runs, does not recurse,
returns rc=0 in both shells.

The brief asked me to confirm the negative regex is not worthless. It is not — I fed it the bad
output directly:

```
$ node -e 'console.log(/\{ CLAUDE_CONFIG_DIR="[^"]*" claude /.test(
    `claude() { CLAUDE_CONFIG_DIR="/Users/ral/.claude-work" claude "$@"; }`))'
NEGATIVE-REGEX-CATCHES-BAD: true
```

So `claude-environment-setup-command.test.mjs`'s
`assert.doesNotMatch(snippet, /\{ CLAUDE_CONFIG_DIR="[^"]*" claude /)` would in fact fail on the
recursive form. The pin is genuine.

**But the guard has one uncovered self-collision** — see #P3-1: the mechanism (`command`) is itself
shadowable, so a label deriving to exactly `command` reintroduces the hang.

### 3. Name derivation — CONFIRMED against the contract's rules; `claude_` is defensible

`deriveEyesOnAgentsClaudeEnvironmentFunctionName` (`eyesOnAgents.contract.ts:441-448`) implements
exactly the stated order: `toLowerCase()` → `/[^a-z0-9_]+/gu → '_'` → `/__+/gu → '_'` →
`'' | '_'` → `claude_env` → leading-digit `_` prefix. I re-derived every row of the delivery's table
against the built module and all 14 match, including `Claude 工作号` → `claude_` and `my_ _env` →
`my_env`. `CLAUDE_ENVIRONMENT_FUNCTION_NAME_LEADING_DIGIT_PATTERN` is non-global (`/^[0-9]/u`,
`:29`), so the `.test()` has no `lastIndex` state hazard; the three `g`-flagged patterns are only
ever used with `.replace()`, which resets `lastIndex`.

**On `claude_`:** the judgement call holds. All three interesting derived names are valid, working,
non-recursive shell function names in both shells — I checked rather than assumed:

```
name_trailing_us  fn=claude_     bash-n=0 zsh-n=0 | bash rc=0 STUB-SAW:[…/.claude-cjk] | zsh rc=0 STUB-SAW:[…/.claude-cjk]
name_digit        fn=_9          bash-n=0 zsh-n=0 | bash rc=0 STUB-SAW:[…/.claude-9]   | zsh rc=0 STUB-SAW:[…/.claude-9]
name_fallback     fn=claude_env  bash-n=0 zsh-n=0 | bash rc=0 STUB-SAW:[…/.claude-fb]  | zsh rc=0 STUB-SAW:[…/.claude-fb]
```

Declining to add an undocumented trim was the right call: trimming *leading* `_` would silently
rewrite the contract's own `_leading` → `_leading` row and the digit-prefix rule's own output. This
is cosmetic and I am not logging it. **Collisions the rules do produce are worth logging** — see
#P3-3.

### 4. Button visibility — CONFIRMED exactly as specified, on real DOM

`ClaudeObservationCard.vue:569-573`:

```ts
const canCopySetupCommand = (environment: EyesOnAgentsClaudeEnvironmentStatus): boolean => (
  environment.id !== ''
  && environment.mode === 'custom'
  && environment.configuredDirectory !== null
);
```

bound as `v-if` at `:126`. The automatic row can never pass: `claudeObservation.service.ts:614` and
`:756` both build `configuredDirectory: state.config.mode === 'custom' ? state.config.configDirectory : null`,
so `mode === 'automatic'` ⇒ `configuredDirectory === null` — the two clauses are mutually
reinforcing, and this is also exactly the Main-side guard at `eyesOnAgents.service.ts:3122`
(`environment.mode !== 'custom' || environment.configDirectory === null`), so renderer visibility and
service authorization cannot drift apart.

The render test is **real DOM, not source text**: `claude-environment-render.test.mjs:8` imports
`JSDOM`, `:224-235` compiles and `app.mount()`s the actual SFC with `ArcoVue`, `:237-241` locate rows
and buttons via `querySelectorAll('[name="…claudeEnvironmentRow"]')` / `querySelectorAll('button')`
and match on `textContent`, and the new test at `:553` clicks the real button and asserts
`mounted.store.calls.copySetup === ['22222222-…']`. Both hide-cases (automatic row, `null`-directory
custom row) and the empty-id sentinel row are exercised behaviorally.

### 5. No leakage — CONFIRMED, and the guard test is meaningful

Independent greps, not a restatement of the delivery's:

- `src/main/eyesOnAgents/eyesOnAgents.service.ts:3117-3132` — read in full; no `console.*`, no
  logger, no `logClaudeBridgeAction`. The only string built from the environment is
  `` `Claude environment "${environment.label}" has no configured directory to wrap` `` (`:3123-3125`)
  — label only, never the directory.
- `grep -n "from 'electron'" src/main/eyesOnAgents/eyesOnAgents.service.ts` → **no match**.
- `grep -n "clipboard" src/main/xpc/eyesOnAgents.handler.ts` → exactly `:1` (the pre-existing
  `import { app, clipboard, dialog, shell } from 'electron'`) and `:271`
  (`writeClipboardText: (text) => clipboard.writeText(text)`); `:563` is a comment. **No new
  `clipboard` import or call site.** The service consumes it only through the injected
  `writeClipboardText: (text: string) => void` dependency declared at `eyesOnAgents.service.ts:98`.
- Store (`:435-438`) and Vue (`:663-670`) never see the snippet at all — it is built in Main and
  handed straight to the clipboard, so it never crosses into a renderer where it could be logged.

The delivery's source-level guard (`claude-environment-setup-command.test.mjs`, test 11) is **not**
vacuous. Its extractor `/async copyClaudeEnvironmentSetupCommand\([\s\S]*?\n  \}/` cannot terminate
early on the method's inner `if`-block brace (that closes at `\n    }`, four spaces, which the
literal `\n  \}` cannot match), so it captures the whole method body — and `/console\.|logger|…/`
would match a real `console.log(snippet)` inserted anywhere in it. The
`(handler.match(/\bclipboard\.\w+\(/gu) ?? []).length === 1` assertion likewise pins the real single
call site I found by grep.

### 6. Failure paths — CONFIRMED, all three fail cleanly with an empty clipboard

Traced end to end:

- **Unknown id.** Handler `:565-569` validates via `parseEyesOnAgentsClaudeEnvironmentIdParams`
  (`eyesOnAgents.contract.ts:588-594` → `parseEyesOnAgentsClaudeEnvironmentId`), so an absent, empty,
  or non-UUID id never reaches the service. A well-formed but unknown UUID reaches
  `resolveClaudeBridgeEnvironment` (`claudeBridgeEnvironment.resolver.ts:12-15`), whose `.find()`
  returns `undefined` → `throw new Error('Claude environment was not found')`. No clipboard write.
- **`null` `configuredDirectory` / automatic environment.** `eyesOnAgents.service.ts:3122-3126`
  rejects before the builder is called, so `configDirectory` is provably `string` at `:3130` (the
  narrowing is what makes the required-`string` builder signature typecheck). Neither `undefined`
  nor `null` nor `''` can be stringified into a path.
- **Dependency never injected.** `requireClaudeDirectoryConfig()` (`:3118`) throws
  `'Claude environment configuration is unavailable'` first.
- **Control-character / empty directory.** `eyesOnAgents.contract.ts:465-467` throws before building.
  Empirically: `dir-newline` → `error: "Claude environment setup command requires a configured directory"`,
  nothing emitted. (Message wording nit at #P3-7.)

All four surface through `runClaudeEnvironmentAction` → `actionError` (store `:670-679`), the existing
action-error surface, and `handleCopySetupCommand`'s `catch` resets `setupCommandCopiedId` to `null`
so a failed copy never renders `Copied` (pinned by the new render test at
`claude-environment-render.test.mjs:632`).

### 7. `EyesOnAgentsApi` dual-`implements` — CONFIRMED, no papering over

`eyesOnAgents.type.ts:633` declares `copyClaudeEnvironmentSetupCommand(params: { id: string }): Promise<void>`.
Both implementers satisfy it structurally: `EyesOnAgentsHandler` at `eyesOnAgents.handler.ts:565-569`
and `EyesOnAgentsService` at `eyesOnAgents.service.ts:3117-3132`. `yarn typecheck:eyes-on-agents:core`
exits 0 → no `TS2416`. Grepping the task's own diff for `\bas any\b|@ts-ignore|@ts-expect-error|eslint-disable|: any`
returns **none**, and neither method has an unused parameter.

The `{ id }`-vs-`{ environmentId }` reasoning **holds in the actual code**: the service passes
`{ environmentId: params.id }` into `resolveClaudeBridgeEnvironment` (`:3119-3121`), whose
`environments[0]` fallback fires only when `params?.environmentId === undefined`
(`claudeBridgeEnvironment.resolver.ts:12`). Because `params.id` is a required `string` — and a
validated UUID once it has been through the handler — `environmentId` is never `undefined`, so the
silent-wrong-environment path is unreachable. Even a direct in-process call with `{ id: '' }` fails
closed: `''` is not `undefined`, so `.find()` misses and it throws `'Claude environment was not found'`.

### 8. The contract-defect note — CONFIRMED, with one unaccounted cost

The shipped code does follow the per-row horn: `eyesOnAgents.store.ts:435-438` calls
`this.runClaudeEnvironmentAction(id, …)`, not `runCommandAction`. The two gates are genuinely
mutually exclusive as the note says — `runCommandAction` (`:644-659`) sets the single global
`this.busyAction`, while `runClaudeEnvironmentAction` (`:664-682`) mutates
`this.busyClaudeEnvironmentIds`, and only the latter can drive the per-row bindings. Per-row busy
state works: the Vue button binds `:loading`/`:disabled` to
`eyesOnAgentsStore.busyClaudeEnvironmentIds.has(environment.id)` (`ClaudeObservationCard.vue:129-130`),
the same key every other row action uses, so copying row A leaves row B's controls live.

The accepted cost is real and confirmed: `runClaudeEnvironmentAction:674` does
`this.applySnapshot(await eyesOnAgentsEmitter.getSnapshot())` after the callback, so a clipboard
write incurs one extra `getSnapshot()`. That trade is reasonable. **What the note does not account
for is the error-attribution consequence** of putting a fallible call *after* an already-committed
side effect — see #P3-5.

### 9. i18n — CONFIRMED, parity and reachability both verified by reading

One new key, `eyesOnAgents.claudeEnvironment.copySetupCommand` (`en.ts:797` `'Copy setup command'` /
`zh.ts:784` `'复制配置命令'`), inserted immediately after `changeDirectory` in both. Key order
compared programmatically:

```
en: title,guidance,addEnvironment,addLabelPlaceholder,add,notConfigured,rename,renameLabelPlaceholder,
    save,cancel,changeDirectory,copySetupCommand,useAutomatic,enable,disable,remove,removeLastHint
zh: title,guidance,addEnvironment,addLabelPlaceholder,add,notConfigured,rename,renameLabelPlaceholder,
    save,cancel,changeDirectory,copySetupCommand,useAutomatic,enable,disable,remove,removeLastHint
ORDER IDENTICAL: true
```

The `copied` confirmation is reused, not duplicated — `eyesOnAgents.claudeBridge.copied` exists in
both locales (`en.ts:757` `'Copied'`, `zh.ts:745` `'已复制'`, both inside the `claudeBridge` block
alongside `copyReloadCommand`) and is read at `ClaudeObservationCard.vue:576`. No orphan introduced:
`copySetupCommand` has exactly one consumer (`ClaudeObservationCard.vue:577`). All access is via
`i18nHelper.*`; `grep -c '\$t(\|useI18n('` on the card → `0`. No hardcoded user-facing text in the
new markup.

### 10. House conventions and scope — CONFIRMED

- **No `forEach`** anywhere in the task's added lines (`git diff … | grep '^+.*forEach'` → none).
- **Semicolons** on every new statement; **module-level arrow consts** for both new exported
  functions (`eyesOnAgents.contract.ts:441`, `:461`) and for the new Vue helpers (`:569`, `:574`,
  `:663`); class **method shorthand** (not arrow fields) for the new service/handler/store methods.
- **Contiguous top-of-file imports above module consts** preserved: the six new consts land at
  `eyesOnAgents.contract.ts:26-35`, inside the existing const block that already runs 20→38, with no
  import moved below them. The service's new import is folded into the existing
  `@shared/eyesOnAgents/eyesOnAgents.contract` block at `:27` — no new import statement.
- **Alias imports** used (`@shared/…`); no new relative-path crossing.
- **`import type`** correctness: the builder is a value and is imported as a value; the new
  `EyesOnAgentsApi` member is a type-only addition.
- **Business logic in the store, not the `.vue`.** The Vue holds only a confirmation `ref`, two pure
  label/visibility helpers, and a 6-line handler; the snippet is built in Main from shared code.
- **`.less` / BEM:** no new `.less` and no new class — the button reuses the existing
  `eyes-connection-card__directories-path` actions row. Nothing to violate the flat/two-`__` rule.
- **`size="mini"`** present (`:128`). **Stable `name`** present:
  `name="eyesOnAgents__connections__claudeEnvironmentCopySetup"` (`:127`), two `__`, matching its six
  siblings in the same file (`…claudeBridge`, `…claudeDirectories`, `…claudeEnvironmentRow`,
  `…claudeEnvironmentGuidance`, `…claudePromptRetention`, `…claudeSetupAction`).
- **`docs/integrations/eyes-on-agents-layout.md`:** the new diagram line 342
  (`│                                                   [Copy setup command] │`) measures **74
  display columns**, identical to every other line of that box (333-352 all 74, measured with
  East-Asian-width awareness — the raw byte lengths differ only because of `·` and `—`). The
  delivery's "re-measured to the existing 74-column width" claim is accurate.
- **`package.json` scope:** the diff is **one line only** — the `test:eyes-on-agents:claude` script,
  with `scripts/eyes-on-agents/claude-environment-setup-command.test.mjs` appended to its final
  `node --test` group. `name`, `version`, `version_code`, `_version` and every other field are
  untouched. The justification holds: the Verify list runs only `:claude` and `:ui`, so an unwired
  new test file would never execute, and task 088 wired `claude-environment-render.test.mjs` the same
  way. Confirmed the file does run — the final group reports 40 tests, which includes all 11 new ones
  by name.

## Blocking findings

**None.**

## Non-blocking (P3) findings

Phrased for direct paste into `docs/plan/backlog.md`.

- **#P3-1 — Task 089 review: an environment label deriving to exactly `command` produces an
  infinitely recursive wrapper — the one case the recursion guard cannot cover, because the guard
  *is* `command`.** `buildEyesOnAgentsClaudeEnvironmentSetupCommand`
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:475`) always emits `command claude "$@"`, and
  `command` is a *regular* builtin in both bash and zsh, so a shell function named `command` takes
  precedence over it. Label `command` (or `Command`/`CoMMand`/`COMMAND`, all deriving to `command`)
  emits `command() { CLAUDE_CONFIG_DIR="…" command claude "$@"; }`. Verified empirically against the
  real contract code with a stub `claude` in a disposable sandbox: **bash hangs** (the probe had to
  `SIGKILL` it after 5s, `rc=124 TIMEOUT`) and **zsh aborts** with
  `command: maximum nested function level reached; increase FUNCNEST?` after 500 frames, so `claude`
  never starts. This is exactly the "recursive shell function would hang the user's terminal" harm
  the task doc calls its single most important correctness detail, and the code comment at
  `eyesOnAgents.contract.ts:456-457` plus
  `scripts/eyes-on-agents/claude-environment-setup-command.test.mjs`'s test-2 comment both state the
  over-general claim that "`command` bypasses function lookup". Not blocking: the trigger requires a
  user to name a Claude config environment exactly `command`, which is implausible, the escaping (the
  real attack surface) is airtight, and the failure is recoverable. Fix by adding a reserved-name set
  to `deriveEyesOnAgentsClaudeEnvironmentFunctionName` — e.g. fall back to `claude_env` (or suffix)
  when the derived name is `command`; note that switching the body to `builtin command claude` only
  moves the collision to a label of `builtin` and drops POSIX-`sh` portability, so name reservation is
  the right shape. Document the rule in
  `docs/features/eyes-on-agents-claude-multi-environment.md` and pin it with a test.

- **#P3-2 — Task 089 review: a configured directory containing `!` yields a snippet that cannot be
  pasted at an interactive prompt in *either* bash or zsh, and the code comment's justification for
  not escaping it is wrong about zsh.** `CLAUDE_ENVIRONMENT_DOUBLE_QUOTE_UNSAFE_PATTERN`
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:35`) deliberately excludes `!`, with the comment
  at `:33-34` stating it "only expands in interactive bash". History expansion also fires inside
  double quotes in **interactive zsh** — macOS's default shell and the one the design doc's own
  example targets. Verified by pasting the emitted snippet into both interactive shells:
  `bash: !b": event not found` then `bash: bang: command not found`, and
  `zsh: event not found: b` then `zsh: command not found: bang` — the function is never defined. `!`
  is a legal macOS/APFS directory-name character, so this is reachable (e.g. `~/Dev/!work/.claude2`).
  The comment's second half is half-true: interactive bash 3.2 does leak the backslash
  (`echo "a\!b"` → `a\!b`), but interactive zsh strips it correctly (`echo "a\!b"` → `a!b`), so the
  stated reason not to escape applies only to bash. Not blocking: the failure is loud, not silent;
  the snippet's documented destination is a shell-profile *file*, where history expansion never
  applies (verified: `source`-ing the same snippet works and round-trips the path exactly); and the
  owner's real path has no `!`. Fix by either single-quoting the assignment
  (`CLAUDE_CONFIG_DIR='…'` with `'` → `'\''`, which removes every double-quote-context hazard at
  once) or escaping `!` and accepting the bash-only cosmetic backslash — and correct the comment
  either way.

- **#P3-3 — Task 089 review: the function-name derivation rules can silently collide, and pasting
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

- **#P3-4 — Task 089 review: the per-row `Copied` confirmation never resets, so it can advertise a
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

- **#P3-5 — Task 089 review: routing the clipboard copy through `runClaudeEnvironmentAction` makes a
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

- **#P3-6 — Task 089 review: the snippet's `#` comment line is rejected when pasted at a
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

- **#P3-7 — Task 089 review: the builder's control-character rejection is the *only* gate for the
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

- **#P3-0 (informational, no action) — Task 089 review: `package.json` was edited outside the task's
  declared Path**, to append the new test file to `test:eyes-on-agents:claude`'s final `node --test`
  group. Genuinely forced (the Verify list runs only `:claude` and `:ui`, so an unwired file would
  never execute) and mechanically identical to what task 088 did. The diff is that one line and
  nothing else — `name`/`version`/`version_code`/`_version` untouched, so it does not collide with
  the concurrent OnlyPreview session's packaging bumps. Same convention gap already logged for task
  081's `docs/INDEX.md`: test-wiring in `package.json` is effectively always in scope and could be
  named in future task Paths.

## The delivery's "Implementation evidence" — what I confirmed and what is inaccurate

### CONFIRMED

1. The byte-for-byte snippet for `claude2` / `/Users/ral/.claude2` — reproduced exactly from the
   built contract module.
2. Six new module-level consts at `eyesOnAgents.contract.ts:23-35`, inside the existing const block.
3. `deriveEyesOnAgentsClaudeEnvironmentFunctionName` exported separately and independently testable.
4. The builder throws `'Claude environment setup command requires a configured directory'` on an
   empty directory or one containing `\0`/`\r`/`\n`, reusing the file's existing
   `CONTROL_CHARACTER_PATTERN`; no malformed, empty, `undefined`, or `null` path can reach the
   clipboard. (Reproduced for all four inputs.)
5. `eyesOnAgents.type.ts:629-633` — the new `EyesOnAgentsApi` member with the required-`{ id }` shape,
   and the stated reason that an omitted id cannot silently target `environments[0]`. The reasoning
   holds in the actual code (`claudeBridgeEnvironment.resolver.ts:12`).
6. No `TS2416`: both `implements`-ers updated, `typecheck:eyes-on-agents:core` exits 0 with no `any`,
   cast, `@ts-ignore`, or dead parameter.
7. `eyesOnAgents.service.ts:27` import; `:3117-3132` method placed after `copyClaudeReloadCommand`;
   `requireClaudeDirectoryConfig()` → `resolveClaudeBridgeEnvironment` → non-`custom`/`null` rejection
   → `writeClipboardText`; deliberately not wrapped in `runClaudeBridgeLifecycle`.
8. `eyesOnAgents.handler.ts:565-569`: validates with `parseEyesOnAgentsClaudeEnvironmentIdParams`,
   delegates, logs nothing, adds no `electron` import; the pre-existing `clipboard` import at `:1` and
   its single injection at `:271` are unchanged.
9. `eyesOnAgents.store.ts:435-438` routes through `runClaudeEnvironmentAction(id, …)`; the declared
   deviation and the reason the two contract bullets are mutually exclusive are both accurate.
10. `ClaudeObservationCard.vue:125-134` button (correct placement, `size="mini"`, per-row
    loading/disabled, stable `name`, `aria-live="polite"` span); `:516` ref; `:569-573`/`:574-578`
    helpers; `:663-670` handler mirroring `handleCopyReloadCommand`. No new `.less`; no business logic
    in the `.vue`.
11. `en.ts:797` / `zh.ts:784`, identical position and identical key order in both files;
    `eyesOnAgents.claudeBridge.copied` reused, not duplicated.
12. `docs/integrations/eyes-on-agents-layout.md:342` diagram line and `:366` row-state row; the
    74-column re-measurement claim is accurate.
13. All 11 new tests in `claude-environment-setup-command.test.mjs` and all 3 new tests in
    `claude-environment-render.test.mjs` pass, on my runs too. The claude-suite final group is
    `tests 40 / pass 40 / fail 0`. The test-2 negative regex is meaningful (it does match the
    recursive form).
14. `package.json` touched only for test wiring; `name`/`version`/`version_code` untouched.
15. `git diff --check` clean, exit 0. `test:eyes-on-agents:core` passes.
16. No Electron / packaged build / Playwright / `test:e2e:*` run; no real `claude` CLI; no real
    `~/.claude` or `~/.claude2` touched. Consistent with everything in the diff and the test fixtures
    (string-only synthetic paths).
17. `docs/features/eyes-on-agents-claude-multi-environment.md` was not modified *by this task* —
    corroborated by the diff containing task 090's design too.
18. At the CRUD boundary, `parseEyesOnAgentsClaudeEnvironmentLabel`
    (`eyesOnAgents.contract.ts:576-578` → `parseEyesOnAgentsText:188`) does reject `\0\r\n`, so the
    comment fold really is a second line of defence for the **label**.

### INACCURATE

1. **"a directory containing `\0`, `\r`, or `\n` … is already impossible upstream
   (`parseEyesOnAgentsClaudeConfigDir` and `requireCanonicalClaudeConfigDirectory` both reject it)"**
   (task doc, "Quoting / escaping decision"). Both halves are wrong.
   `requireCanonicalClaudeConfigDirectory` (`src/main/eyesOnAgents/claudePath.resolver.ts:31`) checks
   only `path.includes('\0')` — `\r` and `\n` pass, and I confirmed a `\n`-containing directory is
   realpath-able and non-symlink on this macOS, so it would clear canonicalization.
   `parseEyesOnAgentsClaudeConfigDir` (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:139-147`)
   checks only non-string / empty / non-absolute — it rejects **none** of `\0`, `\r`, `\n` — and it
   parses the *hook-reported* `claudeConfigDir` field, not the configured environment directory, so it
   is not on this path at all. The builder's own guard is the sole gate. Shipped behavior is still
   safe (it throws, nothing is written); the defence-depth claim is not. See #P3-7.
2. **"`!` … only expands in interactive bash"** (code comment,
   `src/shared/eyesOnAgents/eyesOnAgents.contract.ts:33-34`). Interactive **zsh** expands it too, and
   zsh is macOS's default shell. Empirically: `zsh: event not found: b`. The comment's second clause
   ("`\!` inside double quotes there yields a literal backslash") is true for bash 3.2 but false for
   zsh, which strips the backslash correctly. See #P3-2.
3. **"`command` bypasses function lookup, so the wrapper cannot recurse into itself"** (code comment
   `:456-457`, design doc `docs/features/eyes-on-agents-claude-multi-environment.md:468-469`, and the
   test-2 comment). Over-general: `command` is a regular builtin, so a function *named* `command`
   shadows it and the wrapper recurses. Empirically bash hangs and zsh hits `FUNCNEST`. True for the
   `claude` case the contract actually requires. See #P3-1.
4. **Line-range citations are imprecise in four places** (all trivially, no wrong file or symbol):
   `docs/integrations/eyes-on-agents-layout.md:309-319` — the new paragraph is `309-316` (`317` blank,
   `318-319` are pre-existing text), a 3-line overstatement; `eyesOnAgents.contract.ts:451-476` — the
   builder's comment starts at `450`, the function is `461-476`;
   `ClaudeObservationCard.vue:569-577` — `setupCommandCopyLabel` ends at `578`;
   `eyesOnAgents.handler.ts:562-570` — the method ends at `569`.

### Not inaccurate, but not reproducible as stated

- **"`ℹ tests 102 / ℹ pass 100 / ℹ fail 2`, reproduced identically across 3 runs … [the flake] fired
  in all 3 runs here."** My run of `yarn test:eyes-on-agents:ui` gave
  `ℹ tests 102 / ℹ pass 101 / ℹ fail 1` — only the deterministic `ui-source.test.mjs` bundle-id
  failure; `thread-card-open-capability.test.mjs`'s right-click test **passed**. That is exactly what
  `docs/plan/backlog.md:100-108` documents (a ~6/10 flake, and it explicitly warns that a run showing
  only the bundle-id failure is not evidence the other was fixed). So the delivery's observation was
  honest for its runs, but "reproduced identically" does not generalize, and a reader should not treat
  `fail 2` as this suite's baseline. Either count satisfies the task's Verify gate: no third failure,
  and nothing traceable to this task.
