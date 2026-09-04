# Review 1 — eyes-on-agents-claude-env-paste-path-091 + the inventory socket-path issue

Reviewer: independent review pass (no source edits, no commit, no push, no branch operation; no
Electron / packaged build / Playwright / `test:e2e:*` run; the real `claude` CLI was never invoked,
and no real `~/.claude` or `~/.claude2` was read or written).

**Verdict: `passed`** — 0 blocking findings, 9 non-blocking (P3) findings, and 6 corrections to the
task/issue docs' own claims.

Both changes are correct where it counts. The socket root cause is exactly as stated and I
reproduced it: the parent commit really did concatenate the raw 36-char UUID, the win32 branch
really did already hash, and the new test really does fail when I revert the fix. The throw is not
a crash — I traced it to the one call site and it lands inside the per-environment try/catch,
surfacing as a readable `retrying` row exactly as the issue doc claims. The 091 parser rejects
everything an accidental paste is likely to be, all four mutations I made to it were caught by the
new tests, and the i18n parity claim (23 keys, identical order, no orphans) is exactly true.

What is wrong is in the written record and at the test seams: the label is derived from the **raw**
input, not the canonical path the task doc's *Required behavior* section mandates and the code's own
comment asserts; the `ui-source.test.mjs` narrowing gave up more coverage than its comment admits
(demonstrated with two probes that now pass unnoticed); the `103`-byte socket constant is one byte
below what `bind(2)` actually accepts on this machine (measured, not reasoned); and a now-dead
`pickClaudeConfigDirectory` dependency plus a now-false comment were left behind on
`EyesOnAgentsService`. The same agent wrote both the code and the evidence, and it shows in the
places where the evidence describes an intent the code does not implement.

## Review method

Reviewed commit `bdfbe73` via `git show bdfbe73`. Confirmed it is the commit under review; it is
**not** `HEAD` — `HEAD` on `dev/next` moved to `0e10b51` during this review because a concurrent
session committed the OnlyPreview work that was dirty in the tree at review start. I did not make
that commit, did not stage anything, and did not touch `src/`, `scripts/`, `docs/` except to add
this file. (`package.json`'s `name` also flipped `Bitterless_DEBUG_DEV` → `Bitterless_DEBUG_PROD` in
the working tree during the review; that is a running profile switch, not mine.) The untracked
`docs/plan/tasks/eyes-on-agents-claude-env-edit-path-092.md` and
`docs/issues/eyes-on-agents-omni-search-shortcut-focus.md` were ignored as instructed.

Where a claim was checkable by breaking the code, I broke it — in a **scratch copy** at
`$SCRATCHPAD/revert` (a `cp -R` of `src/`, `scripts/`, `tsconfig*.json` with `node_modules`
symlinked back to the repo), never in the repo. The scratch copy has its own baseline of 2
`ui-source.test.mjs` failures (it lacks the repo files two assertions read), so mutation results
below are quoted against **that** baseline, not the repo's. Scratch was deleted afterwards;
the only file I created inside the repo is this review document. Three other working-tree entries
appeared during the review and are **not** mine: `docs/INDEX.md` and `package.json` (modified by the
concurrent session / a running profile switch) and an untracked `undefined/bundles/auditRunner.cjs`
emitted by `scripts/sqlite-migrations/audit.mjs`, which I never ran — left untouched.

The one syscall probe I ran (`net.createServer().listen()` inside a `mktemp -d`, immediately closed
and unlinked) is described in **B4** below.

---

## Verification I ran

| command | result |
|---|---|
| `yarn typecheck:eyes-on-agents:core` | `Done in 6.13s.` — 0 errors |
| `yarn typecheck:eyes-on-agents:ui` | `Done in 2.68s.` — 0 errors |
| `yarn test:eyes-on-agents:claude` | exit 0; 11 `… tests passed` lines + `tests 27/17/1/45`, `fail 0` in all four `node --test` groups |
| `yarn test:eyes-on-agents:ui` | `tests 105 / pass 104 / fail 1` |
| `yarn eslint` on all 9 touched source files | `539 problems (4 errors, 535 warnings)` — 4 errors, all pre-existing |

**UI suite:** the single failure is the known deterministic one —
`completed threads use one localized silent notification and bundled cross-platform tone`, failing
on `/import\.meta\.env\.VITE_ENV === 'dev'\s*\?\s*'io\.bitterless\.desktop_dev'\s*:\s*'io\.bitterless\.desktop'/`
against `src/main/index.ts`. The ~6/10 flaky `thread-card-open-capability` right-click test **passed**
on this run. Baseline is 105 tests with at most 2 failures; I saw 1. **No third failure.**

**ESLint:** the 4 errors are the 4 the brief predicted, at line numbers shifted by this commit's
added imports, and I confirmed each is byte-identical to the parent:

| error | reported line | parent line | check |
|---|---|---|---|
| `prefer-const` `'operation'` | `eyesOnAgents.service.ts:1310` | `1309` | `git show bdfbe73^:…service.ts \| sed -n '1309p'` and `sed -n '1310p'` both print `    operation = new Promise((resolve) => {` — shifted by the one added import |
| `prefer-const` `'eyesOnAgentsService'` / `'claudeObservation'` | `eyesOnAgents.handler.ts:93,94` | `92,93` | parent `92,93` and head `93,94` both print the same two lines — shifted by the one added import |
| `no-useless-escape` | `eyesOnAgents.store.ts:56` | `56` | unchanged; the store diff starts at line 392 |

0 new errors. Confirmed.

---

## (B) The socket-path fix

### B1 — Root cause claim: CONFIRMED, verbatim

`git show bdfbe73^:src/shared/eyesOnAgents/claudeInventoryBridge.contract.ts` line 47:

```ts
return { transport: 'unix', path: join(safe, 'eyes-on-agents', `claude-inventory${scope}.sock`) };
```

with `scope = '-' + environmentId` (line 42, raw, unhashed) and line 44:

```ts
const suffix = createHash('sha1').update(`${safe}${scope}`).digest('hex').slice(0, 12);
```

So yes: the raw 36-char UUID was concatenated on unix, and win32 already hashed. Every line number
the issue doc cites is exact — `claudeInventoryBridge.contract.ts:36-48` for the function, `44` for
the win32 hash, `47` for the unix branch. `git log -S` confirms the `${scope}` form was introduced
by `93fc548 feat(eyes-on-agents): run one independent watcher per Claude environment`, i.e. task
085, as claimed.

The issue doc's two arithmetic tables are also exact. Recomputed:

```
userData "/Users/ral/Library/Application Support/Bitterless_DEBUG_PROD"       = 60
+ "/eyes-on-agents/"                                                          = 76   (matches "76")
claude-inventory.sock                        21  ->  97    (matches)
claude-inventory-<uuid36>.sock               58  -> 134    (matches)
claude-inventory-<hash12>.sock               34  -> 110    (matches)
ci-<hash12>.sock                             20  ->  96    (matches)
prefixes: Bitterless 65 / _PREVIEW 73 / _DEBUG_DEV 75 / _DEBUG_PROD 76        (all match)
```

### B2 — Hash-input asymmetry (unix hashes `scope`, win32 hashes `${safe}${scope}`): correct, intentional

This is **not** a bug, and the difference is required, not incidental:

- The unix path is `join(safe, 'eyes-on-agents', 'ci-<hash>.sock')` — `safe` is already **in the
  path**, so the directory disambiguates profiles. Hashing it again would buy nothing and cost
  bytes, which is the whole point of the fix.
- The win32 path is `\\.\pipe\bitterless-claude-inventory-<hash>` — a **flat, machine-global**
  namespace with no directory component, so `safe` *must* be inside the hash or two profiles would
  collide on one pipe.

Two-profiles-on-one-machine, measured against the shipped build:

```
Bitterless            -> /Users/ral/Library/Application Support/Bitterless/eyes-on-agents/ci-28b8e9517c65.sock            (85 B)
Bitterless_DEBUG_PROD -> /Users/ral/Library/Application Support/Bitterless_DEBUG_PROD/eyes-on-agents/ci-28b8e9517c65.sock (96 B)
two profiles distinct: true
win32 A: \\.\pipe\bitterless-claude-inventory-0af569c4fc82
win32 B: \\.\pipe\bitterless-claude-inventory-45861b518549
win32 two profiles distinct: true
```

Note the **same filename** in both profiles — that is fine and expected, and it is why the unix
branch does not need `safe`.

**Collision risk of 12 hex (48 bits): adequate.** `MAX_ENVIRONMENTS = 20`
(`claudeDirectoryConfig.service.ts:17`), so the birthday probability is ~`20·19/2 / 2^48` ≈ `7e-13`.
Even at 1000 environments it is `1.8e-9`. Not a concern.

### B3 — Unscoped path byte-identical: CONFIRMED (with one behavioral caveat)

`environmentId === undefined` selects the literal `'claude-inventory.sock'` and `join()` is
unchanged, so the string is identical. Verified against the pre-085 formula directly:

```
/Users/ral/Library/Application Support/Bitterless_DEBUG_PROD/eyes-on-agents/claude-inventory.sock
=== `${userData}/eyes-on-agents/claude-inventory.sock`  ->  true
```

Caveat (P3-6): the new length guard is **outside** the `environmentId === undefined` branch, so the
unscoped path is no longer *unconditionally* returned — a long enough home now makes the unscoped
call throw where it previously returned a path that `bind(2)` would have rejected anyway. That is a
strict improvement, but "so pre-085 callers and their tests are untouched" is true of the string,
not of the control flow. The one remaining unscoped call site is
`claude-inventory.test.mjs:313` with `/tmp/bitterless-test`, far under the limit.

### B4 — The 103-vs-104 reasoning is INACCURATE (measured, not argued)

The issue doc and the code comment both say `sun_path` is 104 bytes on macOS **including the
terminating NUL**, "so the usable path length is 103", and `UNIX_SOCKET_PATH_MAX_BYTES = 103`
(`claudeInventoryBridge.contract.ts:35`).

The 104 figure is right. The `103` conclusion is **empirically wrong on this platform.** I bound
real sockets of exact byte lengths inside a `mktemp -d` (macOS 25.4.0, Node `v24.16.0`, libuv
`1.52.1`), checking that the socket file actually appeared, then closing and unlinking:

```
103 103 OK exists=true
104 104 OK exists=true
105 105 ERR:EINVAL
```

A 104-byte path binds. libuv permits `namelen == sizeof(sun_path)` and macOS's `sockaddr_un` carries
an explicit `sun_len`, so no terminating NUL is required — the "one byte shorter" reasoning is a
Linux idiom that does not hold here.

Consequence is small but real and I pinned it exactly. Sweeping the home-directory length against
the shipped builder, the **first** length the guard rejects is the one that produces a **104-byte**
path:

```
first rejected home-length n= 22  ->  resulting path would be 104 bytes
```

i.e. a macOS user whose username is 22 characters, on the plain `Bitterless` profile, gets a hard
`Claude inventory socket path is 104 bytes, over the 103-byte unix socket limit` for a path the
kernel would have accepted. Exactly one length value is affected, it fails closed with a readable
message rather than silently, and every real profile today lands at 85–96 bytes. Non-blocking, but
the constant and its stated rationale should both be corrected (P3-1).

### B5 — The throw does NOT crash startup or an unrelated path: CONFIRMED

`getClaudeInventoryBridgeEndpoint` has exactly **one** non-test call site:
`src/main/eyesOnAgents/claudeWatcher.supervisor.ts:110`, inside `performStart()`, reached only from
`ClaudeWatcherSupervisor.start()`. `start()` in turn is called from exactly one place for
environments — `claudeObservation.service.ts:981` — and that line sits inside a `try` block:

```ts
977    try {
978      await state.watcher.updateRoots(roots);
980      if (roots.desktopRoots.length > 0 || roots.projectsRoot !== null) {
981        await state.watcher.start();
985    } catch (error) {
986      watcherError = error;
987      await state.watcher.stop().catch(() => undefined);
988    }
```

`watcherError` then flows to `claudeObservation.service.ts:1053-1054` → `boundedError(watcherError)`
→ `setEnvironmentStatus(state, { state: 'retrying', error: <message> })` at 1066-1071, followed by
`scheduleEnvironmentRetry`. So an over-long path renders as a per-environment `Retrying` row
carrying the message that names the limit and the offending byte count — which is precisely the
improvement the issue doc promises, and it does **not** take down startup, the service lifecycle, or
any other environment. The guard converts an opaque failure into an explained one; it does not
convert a degraded state into a hard failure.

(It will retry that unfixable condition forever, but that is identical to the pre-fix `EINVAL`
behavior — not a regression introduced here.)

### B6 — The new tests are load-bearing: CONFIRMED by reverting

In the scratch copy, replacing only `src/shared/eyesOnAgents/claudeInventoryBridge.contract.ts` with
`bdfbe73^`'s version and re-running `node scripts/eyes-on-agents/claude-inventory.test.mjs`:

```
AssertionError [ERR_ASSERTION]: scoped Claude inventory socket path must fit the 103-byte unix limit,
got 134: /Users/ral/Library/Application Support/Bitterless_DEBUG_PROD/eyes-on-agents/
claude-inventory-af147ca5-5493-4079-81db-1c6f8841682b.sock
```

The test reproduces the owner's exact 134-byte path and fails. Per assertion:

| assertion | fails on revert? |
|---|---|
| `<= 103` byte length | **yes** — load-bearing |
| raw UUID absent from path | **yes** — load-bearing |
| throws `/unix socket limit/` on a long home | **yes** — load-bearing |
| two ids → two distinct paths (unix and win32) | no — passes on both; it closes the logged 085 gap, it does not pin this fix |
| unscoped path unchanged | no — passes on both; it is a regression fence, correctly |

Unmodified scratch baseline: `EyesOnAgents Claude inventory tests passed`, exit 0.

---

## (A) The paste-path add flow

### A1 — Trust boundary: the honest residual risk

I traced the pasted string end to end. What Main does with it:

1. **Parse** — `parseEyesOnAgentsAddClaudeEnvironmentParams`
   (`eyesOnAgents.contract.ts:616-631`): bounded to 4096 characters, no NUL/CR/LF, must start with
   `/` or match `^[A-Za-z]:[\\/]`. No filesystem access. Correct as designed.
2. **Validate + canonicalize** — `requireCanonicalClaudeConfigDirectory`
   (`claudePath.resolver.ts:30-45`), called from `ClaudeDirectoryConfigService.addEnvironment`
   (`claudeDirectoryConfig.service.ts:211`): non-empty, no NUL, ≤4096 **bytes**, `isAbsolute`,
   exists, `lstat` says directory and **not** a symlink, and `realpathSync.native`-canonicalized,
   then rejected if it equals the filesystem root.
3. **Persist** — the canonical form is stored; label is a separate field (see A3).
4. **Watch** — `resolveClaudeDirectory` (`claudePath.resolver.ts`) sets
   `projectsRoot = canonicalClaudeDirectory(join(effectiveDirectory, 'projects'))`. The
   `desktopRoots` are the fixed platform Claude Desktop locations and are **not** influenced by the
   pasted path. So the renderer-widened read surface is exactly `<dir>/projects/**`.
5. **Spawn** — `runClaudeCommand` (`claudeCommand.runner.ts:22-30`) sets
   `CLAUDE_CONFIG_DIR: options.configDirectory` with `shell: false` and a fixed argv.

**Is `requireCanonicalClaudeConfigDirectory` sufficient? It is a shape check, not a location
check — and neither the task doc nor the feature doc says so.** Concretely, all of these pass:

- `/etc`, `/Users`, `/private`, `/Applications` — any existing non-root directory.
- `/Users/ral/../../etc` — `..` is resolved by `realpathSync`, and `/etc` then passes.
- `/Users/otheruser` — macOS `/Users/*` is `drwxr-xr-x` by default, so `lstat`/`realpath` succeed.
- `//double/slash`, `///etc` — accepted by the `startsWith('/')` test and normalized later.
- A path whose **parent** is a symlink — only the *leaf* is `lstat`-checked for `isSymbolicLink()`;
  parent symlinks are silently resolved by `realpathSync.native` and the **canonical** form is what
  gets persisted. That is the right call (no stored alias, no TOCTOU on the stored value), and
  `resolve()` re-runs `canonicalClaudeDirectory` on every refresh, so a later swap to a symlink
  flips the row to `retrying` rather than following it.

What a compromised or buggy renderer can therefore actually cause:

- **Read**: make Bitterless recursively watch and parse `<any existing directory>/projects/**` as
  Claude transcripts, surfacing derived rows (cwd, titles, bounded last-user-prompt) into the DB and
  UI. Bounded by `MAX_FULL_PAGES`/`PAGE_SIZE`/`isClaudeInventoryScanComplete`. Another user's
  `~/.claude` is *addable* but unreadable (`drwx------` → scan rejects → `retrying`), so this is not
  a cross-user read.
- **Write**: with a **second** action (per-environment Install), the real `claude` CLI runs with
  `CLAUDE_CONFIG_DIR=<dir>` and creates its config/plugin state inside that directory. This is the
  sharpest edge of the change and is not mentioned in either doc.
- **Delete**: none. I checked — `ClaudePluginBridgeService.marketplaceRoot` is built from
  `dependencies.userDataPath` (`claudePluginBridge.service.ts:285-288`), never from the
  environment's `configDirectory`, so no `rmSync` is ever aimed at a renderer-supplied path.
- **Command injection**: none. `shell: false`, fixed argv; the path only ever becomes an env value.
  The clipboard setup-command builder single-quotes the directory and escapes `'` as `'\''`
  (`eyesOnAgents.contract.ts:56-57, 503-506`) — correct.
- **Huge tree / `/`-adjacent**: `/` itself is rejected. `/etc` and friends have no `projects/`
  subdirectory, so they resolve to `waiting` and read nothing. A directory that *does* contain a
  large `projects/` tree causes bounded scan cost and a recursive watch — degradation, not takeover.

**Assessment:** acceptable. The renderer already holds far broader XPC authority in this subsystem
(it can open threads, drive iTerm2 spawns, and trigger CLI installs), so "propose an existing
directory" is an incremental capability, not a qualitative escalation, and every dangerous verb
(delete, exec, cross-user read) is independently blocked. But the docs oversell the mitigation:
"Main still validates it through `requireCanonicalClaudeConfigDirectory` (absolute, existing,
non-symlink, not a filesystem root)" is factually correct and *reads* as containment, when the list
is exactly the whole of it — there is no scoping to `$HOME`, no exclusion of system paths, and the
CLI-write consequence is unstated. See P3-2.

### A2 — Is the narrowed `ui-source.test.mjs` assertion pinning what its comment claims? Partly — NO for one half

First, the doc's claim that a third failure genuinely appeared is **CONFIRMED**. Restoring the
original `assert.doesNotMatch(rendererSource, /showOpenDialog|pickDirectory|configDirectory\s*:/)`
against the *shipped* renderer source in the scratch copy takes `ui-source.test.mjs` from its scratch
baseline of 2 failures to **3**. The trigger is
`eyesOnAgents.store.ts:395  async addClaudeEnvironment(configDirectory: string)` — note it is the
*type annotation* that matched, not any actual path-carrying payload (`{ configDirectory }` at line
397 is shorthand, no colon). So the old assertion's protection was always partly incidental.

The replacement is:

```js
assert.doesNotMatch(rendererSource, /showOpenDialog|pickDirectory/);
assert.match(store, /addClaudeEnvironment\(configDirectory: string\)/,
  'add is the only renderer path that carries a directory, and it is explicitly typed');
assert.doesNotMatch(store,
  /(?:changeClaudeDirectory|chooseClaudeEnvironmentDirectory|useAutomaticClaudeEnvironment)\([^)]*(?:path|directory|Directory)/,
  'repointing an existing environment must not accept a renderer-supplied path');
```

Three probes in the scratch copy, against its 2-failure baseline:

| probe | caught? |
|---|---|
| new store method sending `{ id, configDirectory }` through `changeClaudeDirectory` | **fail 3 — caught** |
| store method sending `{ id, dir }` through `chooseClaudeEnvironmentDirectory` | fail 2 — **NOT caught** |
| `ClaudeObservationCard.vue` calling `eyesOnAgentsStore.repoint({ id, configDirectory: '/tmp/evil' })` | fail 2 — **NOT caught** |

So:

- **"add is the only renderer path that carries a directory"** is *not asserted*. That line is a
  positive `assert.match` — it proves add carries one, never that nothing else does. The whole-tree
  `configDirectory\s*:` clause that used to make that claim true was dropped and nothing replaced it,
  so a **`.vue` component** can now hand Main a path with no test objecting.
- **"repointing an existing environment must not accept a renderer-supplied path"** *is* asserted,
  but only for three hard-coded method names, only inside `store.ts`, and only when the parameter
  happens to spell `path`/`directory`/`Directory`. Renaming the parameter to `dir` walks through it.

The feature doc's "`scripts/eyes-on-agents/ui-source.test.mjs` pins both halves of that boundary" is
therefore **INACCURATE** — it pins one and a half. Non-blocking (no runtime defect; the shipped code
does not exercise either hole), but the doc claim must be corrected or the assertion widened. See
P3-3.

### A3 — Label derivation: the code does NOT do what the task doc requires

The task doc's *Required behavior* says, verbatim:

> Derive from the **canonical** path the resolver returns, not from the raw input, so
> `/Users/ral/.claude2/` and `/Users/ral/./.claude2` produce the same label.

The code comment at `eyesOnAgents.contract.ts:633-636` repeats it ("Derive from the CANONICAL path
so a trailing slash or a `/./` segment cannot produce a different label"), and the test comment at
`claude-environment-setup-command.test.mjs:447-448` asserts it about the caller ("which is why the
caller derives from the canonicalized path").

**All three are false.** Both Main-side call sites pass the **raw, parsed** value:

- `src/main/xpc/eyesOnAgents.handler.ts:523` — `label: deriveEyesOnAgentsClaudeEnvironmentLabel(configDirectory)`
  where `configDirectory` is the parser output, and `addEnvironment` canonicalizes *afterwards*
  (`claudeDirectoryConfig.service.ts:211`).
- `src/main/eyesOnAgents/eyesOnAgents.service.ts:3061` — same shape.

Canonicalization happens **inside** `addEnvironment`, after the label has already been computed, and
its result is never fed back to the derivation.

The doc's two *named* cases still work, because `deriveEyesOnAgentsClaudeEnvironmentLabel` splits on
`/[\\/]+/u` and filters empties — so trailing slashes and `/./` collapse anyway. But the general
claim does not hold. Measured against the shipped function:

```
"/Users/ral/.claude2"      -> "claude2"     (canonical would agree)
"/Users/ral/.claude2/"     -> "claude2"     (agrees)
"/Users/ral/./.claude2"    -> "claude2"     (agrees)
"/Users/ral/.claude2/."    -> "."           (canonical would give "claude2")
"/Users/ral/.claude2/.."   -> "."           (canonical would give "ral")
"/Users/ral/.."            -> "."           (canonical would give "Users")
"//server/share"           -> "share"
"/Users/ral/  "            -> "  "          (see P3-4)
```

Plus two cases the table cannot show: on a case-insensitive APFS volume, pasting
`/Users/ral/.CLAUDE2` for a directory named `.claude2` yields a row labelled `CLAUDE2` next to a
path column reading `.claude2`; and a path reached through a parent symlink is labelled from the
alias while stored under the real name.

**Why this is not blocking:** the label is not an identity (`id` is), Rename exists and is reachable
on every row, the divergent inputs all require a user to paste a path ending in `/.` or `/..`, and
`addEnvironment` still persists the canonical directory regardless. **Why it still matters:** it is
a *Required behavior* the shipped code does not implement, the Implementation-evidence section does
not disclose the deviation, and two in-repo comments now assert the wrong thing to the next reader.
Either derive inside `addEnvironment` (after `requireCanonicalClaudeConfigDirectory`) or correct all
three claims. See P3-4.

### A4 — Adversarial probing of the parser

Run against the bundled shipped `parseEyesOnAgentsAddClaudeEnvironmentParams`
(control characters written escaped below, never literally):

| input | result |
|---|---|
| `\\server\share` (UNC, backslashes) | **reject** — "must be an absolute path" |
| `//server/share`, `//double/slash`, `///etc` | accept (treated as POSIX absolute) |
| NUL embedded mid-string | reject — "contains a forbidden control character" |
| LF embedded mid-string | reject — same |
| CR at end | accept, **silently trimmed** to the CR-free path |
| TAB mid-string | **accept, passed through unchanged** |
| `\x1f` (unit separator) mid-string | **accept, passed through unchanged** |
| `\x7f` (DEL) mid-string | **accept, passed through unchanged** |
| 4096-char path | accept |
| 4097-char path | reject — "must be at most 4096 characters" |
| 2047 × `é` (4095 bytes, 2048 chars) | accept |
| `C:relative` | **reject** — no separator after the colon |
| `C:/Users/ral`, `c:\Users\ral` | accept |
| `1:\Users` (digit drive) | reject |
| leading/trailing spaces | accept, trimmed |
| `/Users/ral/../../etc` | accept (resolved by Main to `/etc`, which then passes) |
| `/` | accept at the parser, **rejected by Main** ("cannot be a filesystem root") |
| `file:///Users/ral/.claude2` | reject |
| `~/.claude2` | reject — "must be an absolute path" |

**Nothing dangerous or malformed reaches Main.** Two precision corrections:

- The task doc calls the value "control-character-free". `parseEyesOnAgentsText`
  (`eyesOnAgents.contract.ts:191-214`) uses `CONTROL_CHARACTER_PATTERN = /[\0\r\n]/` (line 21) — it
  rejects NUL/CR/LF only. TAB, `\x1f`, `\x7f`, and ESC survive. The blast radius is nil in practice,
  because `requireCanonicalClaudeConfigDirectory` requires the directory to **exist**, so a renderer
  cannot invent a synthetic escape-bearing string — it can only name a directory that is really on
  disk under that name. Pre-existing shared-helper behavior, not introduced here, but the doc's
  wording overstates it. See P3-5.
- Bounds unit mismatch: the parser bounds **characters** (4096), `requireCanonicalClaudeConfigDirectory`
  bounds **bytes** (4096). A 4096-char multibyte path passes the first and is rejected by the second.
  Fail-closed and harmless — noted so nobody "fixes" it in the wrong direction.

UNC rejection means a Windows user cannot add `\\server\share` as a `CLAUDE_CONFIG_DIR`, even though
`path.isAbsolute` on win32 accepts it and Main would too. Defensible restriction, undocumented. See
P3-7.

### A5 — `deriveEyesOnAgentsClaudeEnvironmentLabel` behaviors: all claimed behaviors CONFIRMED

Every behavior the tests assert is real, not restated implementation — I broke each and the tests
caught it. All four mutations were run in the scratch copy against
`claude-environment-setup-command.test.mjs` (baseline `tests 15 / pass 15 / fail 0`):

| mutation | result |
|---|---|
| delete the absolute-path guard | `pass 14 / fail 1` — caught |
| stop stripping the leading dot | `pass 14 / fail 1` — caught |
| widen `assertOnlyKeys` to accept `label` too | `pass 14 / fail 1` — caught |
| drop the `.slice(0, 80)` bound | `pass 14 / fail 1` — caught |
| restore | `pass 15 / fail 0` |

Leading-dot strip, trailing/doubled separators, Windows separators, the dot-only basename case
(`'.'` kept as-is because stripping leaves nothing), the 80-char bound, and both fallbacks
(`base` then `'Claude environment'`) all behave exactly as asserted. The render test is load-bearing
too: mutating `addEnvironmentDirectory.value.trim()` to `addEnvironmentDirectory.value` takes
`claude-environment-render.test.mjs` from `18/18/0` to `17 pass / 1 fail`.

### A6 — Picker removal: both implementations CONFIRMED dropped; one dead dependency LEFT BEHIND

- `src/main/xpc/eyesOnAgents.handler.ts:516-527` — no `pickClaudeConfigDirectory()` call. ✓
- `src/main/eyesOnAgents/eyesOnAgents.service.ts:3056-3066` — no
  `this.dependencies.pickClaudeConfigDirectory?.()` call. ✓
- No caller passes `{ label }` anywhere. `git grep addClaudeEnvironment` returns 11 hits; every
  Main/renderer/type site uses `configDirectory`. ✓
- No unused import: `pickClaudeConfigDirectory` is still a live free function in the handler,
  used at `eyesOnAgents.handler.ts:208` (`pickDirectory:` for `claudeDirectoryConfig`) and at 286.
  Change directory / Use automatic still need it. ✓

**But there is a dead dependency, contrary to what a reader of the evidence would assume.**
`EyesOnAgentsService`'s dependency

```ts
137  // Task 088: reuses eyesOnAgents.handler.ts's existing pickClaudeConfigDirectory free function so
138  // this service's own addClaudeEnvironment delegate can open the same native picker the handler's
139  // real XPC-registered method already uses, rather than duplicating that logic.
140  pickClaudeConfigDirectory?: () => Promise<string | null>;
```

is now **never read** — `grep pickClaudeConfigDirectory src/main/eyesOnAgents/eyesOnAgents.service.ts`
returns only lines 137 and 140. Its sole consumer was the call this commit deleted. The handler
still supplies it at `eyesOnAgents.handler.ts:286`. TypeScript cannot flag it (optional interface
member) and ESLint does not either, so it will sit there silently, and the comment now describes a
delegate that no longer exists. See P3-8.

### A7 — i18n and house conventions

**i18n: exactly as claimed.** Both `claudeEnvironment` blocks have **23** keys in **identical
order**, no en-only or zh-only keys:

```
title, guidance, addEnvironment, addDirectoryPlaceholder, add, notConfigured, rename,
renameLabelPlaceholder, save, cancel, changeDirectory, copySetupCommand, useAutomatic, enable,
disable, remove, removeLastHint, pluginInstalled, pluginDisabled, pluginNotInstalled, pluginUnknown,
installPlugin, checkPlugin
```

`addLabelPlaceholder` survives **only** in historical review/task docs; zero source, script, or test
references. No orphans. ✓

**House conventions:** no `.forEach` in any touched file; semicolons present; `deriveEyesOnAgents…`
and `getClaudeInventoryBridgeEndpoint` are arrow consts; class methods stay method shorthand;
`import type` used for type-only imports; `size="mini"` on both new controls; all user-facing text
goes through `i18nHelper.eyesOnAgents.claudeEnvironment.*` with no hardcoded strings and no `$t()`;
BEM stays flat (`eyes-connection-card__directories-add`, two `__` max); no new file names exceed two
dot suffixes. The add-form nodes carry no `name` attribute — but neither did they before, and the
card already has 8 elsewhere, so this is pre-existing, not a regression.

**Nothing outside the declared Path.** Every file 091 touched is listed in its `## Path`; the four
files outside it (`claudeInventoryBridge.contract.ts`, `claude-inventory.test.mjs`, and the two doc
files) belong to the socket issue, which declares no Path section. The commit does bundle two
independent changes, which the message explains up front; noted, not held against it.

---

## Blocking findings

**None.** I considered blocking on A3 (the shipped code contradicts a *Required behavior* of its own
task doc, and two in-repo comments assert the wrong mechanism), and decided against it: the doc's
stated purpose — that `/Users/ral/.claude2/` and `/Users/ral/./.claude2` yield the same label — is
in fact met by the raw implementation, the divergence is confined to inputs ending in `/.` or `/..`
plus case/symlink aliasing, the persisted directory is canonical either way, and Rename repairs any
label. It is recorded as P3-4 with the exact remediation.

---

## Non-blocking (P3) findings

Each phrased for direct paste into `docs/plan/backlog.md`.

- Task 091 review: `UNIX_SOCKET_PATH_MAX_BYTES = 103`
  (`src/shared/eyesOnAgents/claudeInventoryBridge.contract.ts:35`) is one byte below the real limit.
  A `bind(2)` probe on macOS 25.4 / Node v24.16.0 / libuv 1.52.1 accepts a 104-byte unix socket path
  (file created) and only rejects 105 with `EINVAL`; macOS `sockaddr_un` carries `sun_len`, so the
  "including the terminating NUL, therefore 103" reasoning in the comment and in
  `docs/issues/eyes-on-agents-claude-inventory-socket-path-too-long.md` is a Linux idiom that does
  not apply. Effect: a 22-character macOS username on the plain `Bitterless` profile produces a
  104-byte path that the guard rejects but the kernel would accept. Either raise the constant to 104
  or restate the comment as a deliberate one-byte safety margin; today it claims a fact that is not
  true.
- Task 091 review: the feature doc's trust-boundary note lists
  `requireCanonicalClaudeConfigDirectory`'s checks (absolute, existing, non-symlink, not a
  filesystem root) in a way that reads as containment, but that list is the entirety of the
  validation — there is no scoping to `$HOME` and no exclusion of system paths, so `/etc`,
  `/Applications`, and another user's home all pass. It also omits the sharpest consequence: with a
  second per-environment Install action, the real `claude` CLI runs with `CLAUDE_CONFIG_DIR=<dir>`
  and writes its config/plugin state into that directory. Add one sentence naming both facts so the
  residual capability is on the record rather than implied away.
- Task 091 review: the narrowed `ui-source.test.mjs` trust-boundary assertion does not pin
  "add is the only renderer path that carries a directory" — that line is a positive `assert.match`,
  and the whole-tree `configDirectory\s*:` clause that used to enforce it was dropped with no
  replacement. Two probes pass unnoticed today: a `.vue` component calling
  `eyesOnAgentsStore.repoint({ id, configDirectory: '/tmp/evil' })`, and a store method sending
  `chooseClaudeEnvironmentDirectory({ id, dir })` (parameter spelled `dir`, so it misses the
  `path|directory|Directory` alternation). Restore a whole-`rendererSource` negative that permits
  exactly the one `addClaudeEnvironment(configDirectory: string)` signature, and correct the feature
  doc's "pins both halves of that boundary".
- Task 091 review: `deriveEyesOnAgentsClaudeEnvironmentLabel` is called with the **raw** parsed path
  at `src/main/xpc/eyesOnAgents.handler.ts:523` and
  `src/main/eyesOnAgents/eyesOnAgents.service.ts:3061`, while the task doc's *Required behavior*, the
  function comment (`eyesOnAgents.contract.ts:633-636`), and the test comment
  (`claude-environment-setup-command.test.mjs:447-448`) all state it derives from the **canonical**
  path — canonicalization happens inside `addEnvironment`, after the label is already computed.
  Observable divergence: `/Users/ral/.claude2/.` and `/Users/ral/.claude2/..` both label `"."`; a
  case-insensitive-FS paste labels from the typed case rather than the on-disk case; a path reached
  through a parent symlink labels from the alias. Also, a directory whose basename is whitespace-only
  makes `addEnvironment` throw "Claude environment label is invalid" for what is really a path
  problem. Fix by deriving inside `addEnvironment` from the canonicalized value, or correct all three
  claims.
- Task 091 review: the task doc describes the pasted value as validated to be
  "control-character-free", but `parseEyesOnAgentsText` uses
  `CONTROL_CHARACTER_PATTERN = /[\0\r\n]/` — NUL, CR and LF only. TAB, `\x1f`, `\x7f` and ESC pass
  through into the persisted path, the status row, and the clipboard shell snippet. Harmless today
  (Main requires the directory to exist, so no synthetic string survives), but the wording should
  match the pattern.
- Task 091 review: the new socket length guard sits outside the `environmentId === undefined`
  branch, so the unscoped endpoint can now throw where it previously always returned. The produced
  *string* is byte-identical as the issue doc claims, but the control flow is not — worth one
  clarifying clause in the issue doc so a future reader does not assume pre-085 callers are
  literally untouched.
- Task 091 review: `parseEyesOnAgentsAddClaudeEnvironmentParams` rejects Windows UNC paths
  (`\\server\share`) because the absolute test is `startsWith('/') || /^[A-Za-z]:[\\/]/`, even though
  `path.isAbsolute` on win32 accepts them and `requireCanonicalClaudeConfigDirectory` would too. A
  Windows user cannot add a network-share `CLAUDE_CONFIG_DIR`. Decide whether that is intended and
  say so in the Non-goals, or extend the pattern.
- Task 091 review: `EyesOnAgentsService`'s `pickClaudeConfigDirectory?: () => Promise<string | null>`
  dependency (`src/main/eyesOnAgents/eyesOnAgents.service.ts:137-140`) is now dead — its only
  consumer was the `addClaudeEnvironment` picker call task 091 removed — and its comment still
  describes a delegate that no longer exists. The handler still supplies it at
  `eyesOnAgents.handler.ts:286`. Neither TypeScript (optional member) nor ESLint flags it. Drop both
  the field and the wiring, or repurpose the comment. Related: the render-test mock still names its
  parameter `label` (`claude-environment-render.test.mjs:202`) while the test asserts a directory.
- Task 091 review: each environment now owns a distinct `ci-<hash12>.sock` under
  `<userData>/eyes-on-agents/`, and removing an environment leaves its socket file behind forever —
  `ClaudeInventoryBridgeServer.stop()` unlinks only the endpoint it is currently bound to, and a
  crash skips even that. Pre-085 there was one fixed filename, so this only became an accumulation
  problem with per-environment scoping. Add a sweep of orphaned `ci-*.sock` files on start, or note
  it as accepted.

---

## Claims: CONFIRMED vs INACCURATE

The same agent wrote both the code and the evidence I am checking, so every claim below was checked
against source, command output, or a syscall probe — never accepted on its face.

### CONFIRMED

1. **Issue doc — root cause.** The parent's unix branch really concatenated the raw 36-char UUID
   (`claudeInventoryBridge.contract.ts:47` at `bdfbe73^`), and the win32 branch really already hashed
   to 12 hex (line 44). Verified by reading the parent blob.
2. **Issue doc — line citations.** `claudeInventoryBridge.contract.ts:36-48`, win32 on `44`, unix on
   `47`; `claudePath.resolver.ts:30-45`; `eyesOnAgents.contract.ts:611-617` at the parent — every one
   is exact. (Unlike an earlier review in this plan, the commit hash `bdfbe73` is also correct.)
3. **Issue doc — "Introduced by task 085."** `git log -S'claude-inventory${scope}.sock'` points at
   `93fc548 feat(eyes-on-agents): run one independent watcher per Claude environment`.
4. **Issue doc — both length tables.** All eight numbers (21/97, 58/134, 34/110, 20/96) and all four
   prefixes (65/73/75/76) recomputed exactly.
5. **Issue doc — "hashing alone is not enough".** `claude-inventory-<hash12>.sock` is 110 bytes on
   `Bitterless_DEBUG_PROD`, over any plausible limit. Correct, and it is the non-obvious insight that
   makes the fix right.
6. **Issue doc — "throws a message naming the limit instead of an opaque EINVAL on a status row".**
   Traced the single call site to `claudeObservation.service.ts:981`, inside the `977-988` try/catch,
   through `boundedError(watcherError)` at 1053-1054 into a `retrying` status with that message. No
   startup crash, no unrelated code path taken down.
7. **Commit message — "the unscoped form is unchanged".** Byte-identical to the pre-085 formula.
8. **Task 091 — "no orphan reference remains and the two files' `claudeEnvironment` key order is
   still identical (23 keys each)".** Exactly true; verified by parsing both blocks.
9. **Task 091 — "A third failure did appear mid-work — the trust-boundary assertion — and was
   resolved by narrowing it".** Restoring the original regex against shipped source really does
   produce an extra failure. The claim is honest.
10. **Task 091 — "Both Main-side `addClaudeEnvironment` implementations dropped their
    `pickClaudeConfigDirectory()` call"**, and no caller passes `{ label }`.
11. **Task 091 — the parser "must not touch the filesystem".** It does not; every stat stays in
    `requireCanonicalClaudeConfigDirectory`.
12. **Task 091 / commit — verification results.** Core and UI typechecks 0 errors; claude suite
    `fail 0` in all four `node --test` groups and exit 0; UI 105 tests with only logged pre-existing
    failures; eslint 0 new errors. All reproduced.

### INACCURATE

1. **"`sun_path` is 104 bytes … including the terminating NUL, so the usable path length is 103."**
   (issue doc, and the comment at `claudeInventoryBridge.contract.ts:32-34`.) Measured: a 104-byte
   path binds successfully on macOS 25.4 / Node v24.16.0 / libuv 1.52.1; only 105 gives `EINVAL`. The
   constant is conservative by one byte and its stated reason does not hold on macOS. Nothing in the
   fix's conclusions changes, but the guard rejects exactly one length the kernel would accept.
2. **"Derive from the **canonical** path the resolver returns, not from the raw input."** (task doc
   *Required behavior*.) The shipped code derives from the raw parsed input at
   `eyesOnAgents.handler.ts:523` and `eyesOnAgents.service.ts:3061`; canonicalization happens later,
   inside `addEnvironment`. The *Implementation evidence* section does not disclose the deviation.
3. **"Derive from the CANONICAL path so a trailing slash or a `/./` segment cannot produce a
   different label."** (code comment, `eyesOnAgents.contract.ts:633-636`.) Same defect, now asserted
   in-source where the next reader will trust it. The two named cases work by accident of the split
   regex, not by canonicalization.
4. **"…which is why the caller derives from the canonicalized path."** (test comment,
   `claude-environment-setup-command.test.mjs:447-448`.) The caller does not.
5. **"`scripts/eyes-on-agents/ui-source.test.mjs` pins both halves of that boundary."** (feature doc.)
   It pins the "no native dialog" half and the "existing environments stay path-free" half only for
   three hard-coded method names in one file; the "add is the *only* path carrying a directory" half
   is asserted by a positive match that cannot prove it, and I demonstrated two uncaught erosions.
6. **"validates it as a bounded, absolute, control-character-free string."** (task doc *Required
   behavior*.) Only NUL, CR and LF are rejected; TAB, `\x1f`, `\x7f` and ESC pass through.

### Process notes, not claims

- `docs/plan/backlog.md:61-64` still carries the open task-085 entry — *"no test constructs two real
  Claude environment ids and asserts `getClaudeInventoryBridgeEndpoint` produces two distinct
  socket/named-pipe paths"* — even though this commit adds exactly that test and both the commit
  message and the issue doc say it closes that gap. The entry should have been struck in the same
  change.
- `docs/INDEX.md` was not updated. Of the 19 `eyes-on-agents` issue docs tracked at `bdfbe73`,
  18 are indexed; `issues/eyes-on-agents-claude-inventory-socket-path-too-long.md` is the sole
  omission.
- The task doc still reads *"Not yet independently reviewed … Worth a review pass before this is
  considered closed"*. This document is that pass; update the *Review* section to point here.
