---
id: eyes-on-agents-iterm2-reveal-applescript-094
scope: Replace the inert iterm2:///reveal Open route with an AppleScript session select keyed on the UUID half of the stored ITERM_SESSION_ID, log every attempt and outcome, stop marking threads opened on failure, and add the hardened-runtime Apple Events packaging prerequisites
status: done
depends-on: [eyes-on-agents-claude-iterm2-section-093]
verify: focused EyesOnAgents claude/UI unit tests, Core + UI strict typecheck, desktop package audit tests, eslint on every touched file; osascript scripting probe against the real iTerm2; no Electron, no packaged build, no E2E
---

# EyesOnAgents iTerm2 Reveal via AppleScript

## Objective

Repair [Open in iTerm2 does nothing](../../issues/eyes-on-agents-open-in-iterm2-does-nothing.md).
The action shipped in tasks 082/083 had no effect at all, and reported success while having none.

Two stacked defects, both measured on the owner's machine before this task started:

1. `iterm2:///reveal?sessionid=…` is not a real iTerm2 capability. The `iterm2:` scheme is
   registered, so LaunchServices delivers the URL and iTerm2 ignores it — with the full
   `ITERM_SESSION_ID` *and* with its bare UUID. There is no `/reveal` route.
2. Even a working scheme would have received the wrong identifier. `ITERM_SESSION_ID` is
   `w{window}t{tab}p{pane}:{UUID}`; iTerm2's own session id — the only thing a `select` can key on —
   is the bare UUID.

Nothing logged the attempt, and `markOpened` ran unconditionally after `openExternal` resolved, so
the failure was invisible in `main.log` and looked like success in the UI. Owner instruction for this
repair: 「少日志就打日志」 — add the logging that was missing.

## Root cause of the *invisibility*, separately from the transport

`this.dependencies.openExternal(url)` resolves whether or not the receiving app does anything.
Nothing in the delivery observed iTerm2 afterwards, every test asserted the URL string (which was
built exactly as designed — the design was wrong), and the service marked the thread opened and
returned a snapshot as if it had succeeded. Any repair that keeps a fire-and-forget transport,
returns a synthetic URL, or marks opened before confirming the outcome reproduces this class of bug.

## Required behavior

- The stored `iterm2_session_id` keeps the verbatim captured `ITERM_SESSION_ID`. The capture is
  correct; only its *use* was wrong. The UUID is derived at Open time by a pure, exported contract
  function that reuses task 081's `CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN` and returns `null` rather
  than throwing when the value does not match.
- The transport is an injected dependency, not a call into `openExternal`. It runs `osascript`
  through `child_process.execFile` (never a shell), passes the UUID as `item 1 of argv` (never
  interpolated into script text), re-validates it against the strict UUID shape before spawning,
  walks windows → tabs → sessions, `select`s window/tab/session on a match, and returns a
  distinguishable `revealed` / `not_found` / `denied` result parsed from a token the script prints.
- Nothing is launched, raised, or activated when there is no match — including iTerm2 itself.
- The call is bounded by a timeout and an output cap.
- `openThreadInIterm2` rejects with a clear error when the stored id yields no UUID, reports
  `not_found` (pane gone) and `denied` (Apple Event refused, `-1743`) as distinct actionable errors,
  and calls `markOpened` **only** when the reveal actually succeeded.
- Every attempt and outcome is logged under a `[claude-iterm2]` scope tag following
  `claudeBridgeLog.helper.ts`, sanitized and length-bounded, identified by session id only — never a
  `cwd`, transcript path, or `configDirectory`.
- `build/entitlements.mac.plist` gains `com.apple.security.automation.apple-events`;
  `electron-builder.tmp.yml` gains `mac.extendInfo.NSAppleEventsUsageDescription` and an explicit
  `mac.entitlements`. Without these a hardened-runtime build is refused Apple Events and macOS never
  even prompts.
- The feature doc's "Open" section is corrected — the URL scheme does not work, the stored id is the
  full `ITERM_SESSION_ID` while the reveal uses its UUID, and the one-time Automation prompt is now
  part of the flow rather than an advantage of the design.

## Non-goals

- WezTerm and Ghostty (unchanged: `wezterm cli activate-pane` is a CLI, not a URL scheme, and
  Ghostty has no per-pane environment variable yet).
- Re-deriving or repairing a stale `iterm2SessionId`. A stale id is now *detected and reported*
  rather than silently ignored; nothing re-binds the row to a different pane.
- Any Apple Event beyond the one session-`select` script, and any other scripted application.
- Notarization, signing identity, or TCC-reset tooling. The one-time consent prompt is the owner's
  click to make, from a freshly packaged build.

## Path

- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/iterm2Reveal.helper.ts` (new)
- `src/main/eyesOnAgents/claudeIterm2Log.helper.ts` (new)
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `build/entitlements.mac.plist`
- `electron-builder.tmp.yml`
- `scripts/eyes-on-agents/claude-iterm2-open.test.mjs`
- `docs/features/eyes-on-agents-iterm2-open.md`,
  `docs/integrations/eyes-on-agents-layout.md`,
  `docs/issues/eyes-on-agents-open-in-iterm2-does-nothing.md`, `docs/INDEX.md`

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`,
  `yarn test:eyes-on-agents:core`, `yarn test:eyes-on-agents:repository`
- `yarn test:desktop-package-audit`
- `yarn eslint` on every touched source file — no new errors
- An `osascript` scripting probe against the real iTerm2, restoring the previously focused session
- No Electron, no packaged build, no Playwright, no `test:e2e:*`

## Implementation evidence

### 1. UUID extraction, in shared contract code

`src/shared/eyesOnAgents/eyesOnAgents.contract.ts` gains
`extractEyesOnAgentsIterm2SessionUuid(value): string | null`, beside where
`buildEyesOnAgentsIterm2DeepLink` used to be. It tests the whole value against task 081's imported
`CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN` (no second shape regex), slices after the first `:`, and
returns the UUID lower-cased only when the file's existing strict `UUID_PATTERN` accepts it —
`CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN` only bounds the UUID half to 36 hex/dash characters, so the
strict pattern is what decides whether a derived value may reach a process argument. It returns
`null` instead of throwing so an unexpected stored value is a logged, reportable outcome.

`parseEyesOnAgentsIterm2SessionId` and the DAO's `iterm2_session_id` read/write path are unchanged:
the full captured value is still what is stored and still what is validated on the way in.

`buildEyesOnAgentsIterm2DeepLink` is **deleted**. It became unused with this change, and a builder
for a URL scheme that accepts and ignores every request is a trap for the next reader; the test
suite now asserts it does not exist.

### 2. Contract change: `{ snapshot }`, not `{ url, snapshot }`

`EyesOnAgentsApi.openThreadInIterm2` (and the XPC handler, and the service) now return
`{ snapshot }`. There is no URL, and returning a synthetic one is precisely how the original defect
stayed invisible. Every caller was checked: the renderer store
(`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:517-534`) already used only
`result.snapshot`, and `scripts/eyes-on-agents/focus-board-store.test.mjs`'s harness already returned
`{ snapshot: openSnapshot }`, so neither needed an edit; the service test's `result.url` assertion was
retargeted. `openThread` (Codex + Claude Desktop) is untouched and still returns `{ url, snapshot }`.

### 3. The osascript invocation, and how the id reaches it

`src/main/eyesOnAgents/iterm2Reveal.helper.ts` owns the transport and is wired at the composition
root as the new optional service dependency
`revealIterm2Session?: (sessionUuid: string) => Promise<'revealed' | 'not_found' | 'denied'>`
(`src/main/xpc/eyesOnAgents.handler.ts`, beside `openExternal`). It is optional so every pre-094 test
harness that constructs `EyesOnAgentsService` without it keeps working; absence is reported as an
error, never as success.

Exact invocation:

```text
execFile('osascript', ['-e', ITERM2_REVEAL_SCRIPT, '<uuid>'], {
  timeout: 20_000, maxBuffer: 4_096, windowsHide: true
})
```

- **No shell.** `execFile`, promisified with `node:util`.
- **The id is never in the script text.** The script is `on run argv` / `set targetId to item 1 of
  argv`; the UUID is a separate `execFile` argument. `buildIterm2RevealArgs` re-validates it with the
  contract's own `parseEyesOnAgentsUuid` before the spawn, so the prefixed `ITERM_SESSION_ID` and any
  injection-shaped string are rejected at the process boundary (`iTerm2 session UUID must be a UUID`).
  A test asserts `ITERM2_REVEAL_SCRIPT.includes(uuid) === false`.
- **Nothing is launched or raised without a match.** `application id "com.googlecode.iterm2" is
  running` is checked *before* any `tell`, because a bare `tell application …` launches the app. The
  `select w` / `select t` / `select s` / `activate` sequence is inside the match branch only.
- **`ignoring case`** wraps the comparison: iTerm2 reports session ids upper-cased and the derived
  UUID is canonicalized lower-case. AppleScript already compares text case-insensitively by default;
  stating it keeps that dependency explicit rather than accidental.
- **Bounded.** 20s timeout — long enough for the owner to answer the one-time Automation dialog,
  short enough that a wedged iTerm2 cannot pin an XPC call open past the 120s Apple Event default —
  plus a 4KB `maxBuffer`.
- **Token, not exit code.** The script prints `bitterless-iterm2-reveal:revealed` or
  `…:not_found`; `interpretIterm2RevealOutput` maps those two and throws on anything else, so an
  unrecognized stdout is a failure rather than an assumed success.

### 4. not_found / denied detection

- `not_found`: the script walked every window/tab/session and matched nothing (or iTerm2 is not
  running). Surfaced as `That iTerm2 session is no longer open`.
- `denied`: `isIterm2AutomationDenied` matches `/-1743|errAEEventNotPermitted/`. Surfaced as
  `macOS blocked Bitterless from controlling iTerm2. Allow it under System Settings >
  Privacy & Security > Automation, then try again`.
- anything else: `summarizeIterm2RevealFailure` keeps the first line, bounded to 200 characters,
  prefixed `iTerm2 could not be scripted: `.

Both read the same `revealErrorDetail(error)`, which is deliberately **not** `error.message`:
`execFile` prefixes its failure message with the whole command, and the command here is the entire
AppleScript plus the session UUID. Matching that message would (a) log ~1KB of AppleScript and
(b) misread any failure whose UUID happens to contain the substring `-1743` as a permission
denial — roughly 1 UUID in 16k, i.e. exactly the class of latent trap this task exists to remove.
`revealErrorDetail` therefore prefers osascript's own `stderr`; falls back to `osascript timed out`
when the process was killed by the timeout; collapses a `Command failed…` message to
`osascript exited without output`; and otherwise passes a non-echo message (`spawn osascript
ENOENT`) through. Two tests pin the `-1743`-in-the-command-line false positive shut, with and
without stderr.

All three land in the renderer: the store's `openThreadInIterm2` sets `actionError` from the error
message and rethrows, and `App.vue` renders `actionError` in its banner.

### 5. markOpened

Before: `openExternal(url)` → `markOpened` → `notify()` → `{ url, snapshot }`, unconditionally.
After: `markOpened` + `notify()` run **only** on `revealed`. `not_found`, `denied`, a thrown
osascript failure, a missing UUID, and a missing transport all reject with the thread's
opened/read state untouched. Asserted four ways in
`scripts/eyes-on-agents/claude-iterm2-open.test.mjs` by requiring the recorded call list to be
exactly `['reveal:<uuid>']` — no `opened:` and no `broadcast`.

### 6. Logging

`src/main/eyesOnAgents/claudeIterm2Log.helper.ts`, mirroring `claudeBridgeLog.helper.ts` (sanitized,
length-bounded error text; injectable logger defaulting to `console`):

```text
[claude-iterm2] action=reveal stage=attempt   id=claude:<sessionId> session=<uuid>
[claude-iterm2] action=reveal stage=revealed  id=claude:<sessionId> session=<uuid>
[claude-iterm2] action=reveal stage=not_found id=claude:<sessionId> session=<uuid>
[claude-iterm2] action=reveal stage=denied    id=claude:<sessionId> session=<uuid> error=<bounded>
[claude-iterm2] action=reveal stage=failed    id=claude:<sessionId> session=<uuid|none> error=<bounded>
```

`attempt` / `revealed` / `not_found` go to `info`; `denied` / `failed` to `error`. The scope tag
matches the `[claude-bridge]` / `[claude-environment]` / `[claude-watcher]` convention. Identity is
the Claude session key plus the derived iTerm2 session UUID — both content-free — and error text is
capped at 300 characters. A test asserts the exact line shapes, the `session=none` form when no UUID
could be derived, the 300-character bound, and that **no** emitted line contains a `/`.

### 7. Packaging prerequisites, and what was verified about electron-builder

- `build/entitlements.mac.plist` gains `com.apple.security.automation.apple-events` (`plutil -lint`
  clean; `plutil -p` shows the six expected keys).
- `electron-builder.tmp.yml` gains
  `mac.extendInfo.NSAppleEventsUsageDescription: Bitterless controls iTerm2 to bring a Claude Code
  session's terminal pane to the front.` — a short, honest string naming iTerm2. Without it macOS
  refuses the event silently instead of prompting.
- `mac.entitlements: build/entitlements.mac.plist` is now set explicitly, alongside the existing
  `entitlementsInherit`.

**The tracked file is `electron-builder.tmp.yml`, not `electron-builder.yml`.**
`electron-builder.yml` is untracked, generated from the template by `scripts/before.js`
(`appId` / `productName` / output dir / `executableName` / icon stem / `ARTIFACT_STEM`), and
`scripts/package/desktopPackageAudit.test.mjs` asserts against the template. Editing the generated
file would be overwritten on the next prebuild, so it was left alone; the next build regenerates it
with these keys. The YAML was parsed with `js-yaml` to confirm both new keys and the folded
description value, and that `electronLanguages` is unchanged.

**Verified against the pinned toolchain, and it contradicts the issue doc.** The issue's packaging
note claimed that with only `entitlementsInherit` set, "electron-builder signs the app bundle with
its own defaults". In the installed `app-builder-lib@26.7.0`,
`MacPackager.getOptionsForFile` (`node_modules/app-builder-lib/out/macPackager.js:346-393`) resolves
the **root** bundle's entitlements as `customSignOptions.entitlements` →
`resourceList.includes('entitlements.mac.plist')` → the bundled template, where `resourceList` is
`readdir(buildResourcesDir)` (`platformPackager.js:46`) and `directories.buildResources` is `build`.
`build/entitlements.mac.plist` is therefore already picked up for the app bundle by build-resources
convention, and that resolver is the one the signing path uses (`macPackager.js:318` passes it as
`optionsForFile` into `doSign`). So the explicit `mac.entitlements` is intent-stating and
version-proofing, **not** the fix — the missing entitlement *key* was. The issue doc has been
corrected in place rather than left to contradict this task.

`scripts/package/desktopPackage.audit.cjs` and `scripts/package/desktopPackageAudit.test.mjs` assert
nothing about entitlements or `Info.plist` (grepped for `entitle` / `Info.plist` / `extendInfo` /
`plist`: no hits in the audit; the test's only builder assertions are `afterPack`, `files`
exclusions, `extraResources`, `mac.binaries`, output dirs, and `electronLanguages`). The audit test
suite was run anyway and passes.

### 8. Test retargeting

`scripts/eyes-on-agents/claude-iterm2-open.test.mjs` went from 4 tests to 12. No coverage was
deleted: the three pre-existing behavioral tests (projection visibility, codex-row rejection,
null-identity rejection) are unchanged, and the one URL-asserting test was retargeted rather than
removed.

New / retargeted:

1. `the stored ITERM_SESSION_ID yields its bare UUID and nothing else does` — extraction, prefix
   stripping for arbitrary `w/t/p` numbers, lower-case canonicalization, and `null` for a bare UUID,
   a non-string, an empty string, a malformed UUID half, trailing whitespace, and a non-numeric
   prefix.
2. `no iTerm2 URL builder survives and the reveal script never carries the id` — asserts
   `contractModule.buildEyesOnAgentsIterm2DeepLink === undefined`, the exact
   `['-e', script, uuid]` argv, `script.includes(uuid) === false`, `on run argv`,
   `item 1 of argv`, the `is running` guard, the `select w`/`select t`/`select s` sequence, and that
   both the prefixed `ITERM_SESSION_ID` and an injection-shaped string are rejected before a spawn.
3. `the reveal outcome is read from the script token and -1743 is read as denied` — token mapping,
   the throw on unrecognized stdout, `-1743` and `errAEEventNotPermitted` detection, a non-denial
   (`-1728`) *not* matching, a UUID containing `-1743` in the echoed command line *not* matching
   (with and without stderr), and the failure summary keeping stderr's first line while never
   echoing `Command failed`, plus the timeout and `ENOENT` forms.
4. `openThreadInIterm2 reveals the pane by UUID, marks opened, and notifies` — replaces the URL
   assertion: the reveal receives the **bare UUID**, the result has exactly one key (`snapshot`), no
   `open:` call is ever recorded, and the Codex-only status sync is never run.
5. `a session that is gone reports not_found and never marks the thread opened`.
6. `a denied Apple Event is a distinct, actionable failure and never marks opened`.
7. `an osascript failure propagates and never marks the thread opened`.
8. `a runtime with no reveal transport fails loudly instead of reporting success`.
9. `every reveal attempt and outcome is logged by session id, never by path`.

The harness gained an injected `revealIterm2Session` recording `reveal:<uuid>` into the same
ordered call list `openExternal`/`markOpened`/`broadcast` already use (which is what makes
"markOpened did not happen" assertable as an exact array), plus a `withoutReveal` option.

No other test asserted the old URL: `grep -rn "iterm2:///reveal\|reveal" scripts tests` found nothing
outside this file, and `scripts/eyes-on-agents/ui-source.test.mjs` /
`thread-card-open-capability.test.mjs` / `focus-board-store.test.mjs` only exercise the renderer's
`openThreadInIterm2(sessionKey)` call and its `{ snapshot }` return, which are unchanged.

### 9. Real-iTerm2 scripting probe

The **production helper** (esbuild-bundled from `src/main/eyesOnAgents/iterm2Reveal.helper.ts`, not a
copy of the script) was run against the owner's running iTerm2. It is a scripting probe: no Electron,
no packaged app, no `claude` CLI, and `~/.claude` / `~/.claude2` untouched.

```text
focused-before: 19A63408-6D7A-45AA-AFF4-4258DA0D2C9A
reveal-other: revealed
focused-after: 0B48EB12-DB78-4D6C-9E6A-5DF972D92274
reveal-unknown: not_found
focused-after-unknown: 0B48EB12-DB78-4D6C-9E6A-5DF972D92274
restore: revealed
focused-restored: 19A63408-6D7A-45AA-AFF4-4258DA0D2C9A
prefixed-id-rejected: iTerm2 session UUID must be a UUID
```

A lower-cased UUID matched an upper-cased session id and moved focus; an unknown UUID returned
`not_found` and moved nothing; the originally focused session was restored. The prefixed
`ITERM_SESSION_ID` is rejected before a spawn — which is exactly the identifier the shipped code was
passing.

## Verification evidence

Final output lines, in order:

```text
$ yarn typecheck:eyes-on-agents:core
$ tsc -p scripts/eyes-on-agents/tsconfig.strict.json
Done in 5.21s.                                          (exit 0)

$ yarn typecheck:eyes-on-agents:ui
$ vue-tsc --noEmit -p scripts/eyes-on-agents/tsconfig.ui.json --composite false
Done in 2.85s.                                          (exit 0)

$ yarn test:eyes-on-agents:core
EyesOnAgents core tests passed
Done in 1.30s.                                          (exit 0)

$ yarn test:eyes-on-agents:repository
EyesOnAgents repository tests passed
Done in 0.84s.                                          (exit 0)

$ yarn test:eyes-on-agents:claude                        (exit 0)
groups: tests 27 / pass 27 / fail 0
        tests 17 / pass 17 / fail 0
        tests  1 / pass  1 / fail 0
        tests 54 / pass 54 / fail 0     (was 46 before this task: +8 new tests in this file)
Done in 11.49s.

$ yarn test:eyes-on-agents:ui                            (exit 1 — pre-existing)
ℹ tests 106
ℹ pass 105
ℹ fail 1
✖ completed threads use one localized silent notification and bundled cross-platform tone

$ yarn test:desktop-package-audit                        (exit 0)
ℹ tests 28
ℹ pass 28
ℹ fail 0
Done in 1.21s.

$ node --test scripts/eyes-on-agents/claude-iterm2-open.test.mjs
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

`:ui` totals are unchanged at 106 tests. The single failure is the deterministic pre-existing
`appId` bundle-id assertion in `ui-source.test.mjs`, which fails identically on the pre-change tree
(baseline captured before any edit: 106 tests / 104 pass / 2 fail — that assertion plus the known
flaky `thread-card-open-capability.test.mjs` right-click test, which passed on every run after the
change). No third failure.

eslint, per touched file (error counts; warnings are repo-wide prettier noise):

```text
src/shared/eyesOnAgents/eyesOnAgents.contract.ts        0
src/shared/eyesOnAgents/eyesOnAgents.type.ts           0
src/main/eyesOnAgents/iterm2Reveal.helper.ts           0
src/main/eyesOnAgents/claudeIterm2Log.helper.ts        0
src/main/eyesOnAgents/eyesOnAgents.service.ts          1   pre-existing prefer-const (line 1313)
src/main/xpc/eyesOnAgents.handler.ts                   2   pre-existing prefer-const (lines 95, 96)
scripts/eyes-on-agents/claude-iterm2-open.test.mjs     6   pre-existing explicit-function-return-type
```

The 6 `.mjs` errors were confirmed pre-existing by linting `git show HEAD:` of the same file: the
identical 6 `explicit-function-return-type` errors on the same functions, at pre-edit line numbers.
Untouched sibling tests in the same directory carry 10 and 17 of them. Zero new eslint errors.

## What could not be verified without a packaged build

- That the signed app bundle actually carries `com.apple.security.automation.apple-events` and that
  macOS shows the "Bitterless wants to control iTerm2" prompt. Both keys are code-review- and
  toolchain-source-verified, and the audit tests pass, but only `codesign -d --entitlements` on a
  packaged `.app` proves the entitlement landed.
- The end-to-end owner flow (row in Focus → **Open in iTerm2** → prompt → pane raised). Per this
  repo's rules, no Electron, packaged build, or E2E suite was run.
- One sanctioned side effect of the scripting probe: `activate` brought iTerm2 to the front. The
  focused *session* was restored exactly; macOS app z-order was not.
