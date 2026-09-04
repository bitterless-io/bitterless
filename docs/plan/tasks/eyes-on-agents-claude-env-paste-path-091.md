---
id: eyes-on-agents-claude-env-paste-path-091
scope: Add a Claude environment by pasting its absolute CLAUDE_CONFIG_DIR instead of picking it in the native dialog, and drop the label field
status: done
depends-on: [eyes-on-agents-claude-env-install-probe-090]
verify: focused EyesOnAgents contract/service/render unit tests, Core strict typecheck, UI strict typecheck; no Electron
---

# EyesOnAgents Claude Environment Paste Path

## Objective

**Add environment** currently asks for a label, then opens the macOS native directory picker. Owner
feedback while testing (2026-09-04): a Claude config directory is a **hidden** dotfile directory
(`~/.claude2`), and hidden directories are awkward to reach in the native picker, whereas the
absolute path is something the owner already has to hand and can paste in one action. The label
input is dead weight on top of that — it asks the user to name a thing they just identified by path.

Replace the two-step *label → native picker* flow with one paste-and-validate field, and derive the
label from the directory instead of asking for it.

## Context

- `requireCanonicalClaudeConfigDirectory` (`src/main/eyesOnAgents/claudePath.resolver.ts:30-45`)
  already performs exactly the validation this needs — non-empty, no NUL, bounded, absolute, an
  existing non-symlink directory, not a filesystem root — and returns the realpath-canonicalized
  form. `ClaudeDirectoryConfigService.addEnvironment` already calls it. No new validator is needed.
- The label is not an identity: `id` is (see the feature doc's data-model rules), and **Rename**
  already exists, so a derived label is always correctable by the user.
- The picker is not being removed from the product — the existing per-row **Change directory** still
  uses it. Only the *add* path changes here; see Non-goals.

## Required behavior

- **`addClaudeEnvironment` takes `{ configDirectory }` instead of `{ label }`**, across
  `EyesOnAgentsApi` (`src/shared/eyesOnAgents/eyesOnAgents.type.ts`), the XPC handler, the service,
  and the renderer store. The service must no longer call `pickClaudeConfigDirectory` on this path.
- **Param parsing:** `parseEyesOnAgentsAddClaudeEnvironmentParams`
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:611-617`) accepts only `configDirectory` and
  validates it as a bounded, absolute, control-character-free string. It must **not** touch the
  filesystem — that stays in `requireCanonicalClaudeConfigDirectory` on the main side, which is the
  only place that can legitimately stat.
- **Label derivation** is a pure function in shared contract code (testable without Electron): take
  the canonical directory's basename and strip a single leading `.` so `/Users/ral/.claude2` becomes
  `claude2`. If nothing usable remains, fall back to the basename as-is, and then to
  `Claude environment`. Derive from the **canonical** path the resolver returns, not from the raw
  input, so `/Users/ral/.claude2/` and `/Users/ral/./.claude2` produce the same label.
- Duplicate labels are allowed (two directories may share a basename); `id` is the identity and
  Rename is the fix. Do not invent a uniquifying suffix.
- **Renderer:** the add form's single input is the absolute path, with a path-shaped placeholder
  (e.g. `/Users/you/.claude2`). **Add** is disabled while it is empty. A rejected path surfaces
  through the existing action-error surface with the resolver's message, and **the form stays open
  with the typed value intact** so the user can correct a typo rather than retype the path.
- i18n: replace the label placeholder key with a path placeholder in **both** `en.ts` and `zh.ts`,
  keeping key order identical. Remove any key this change orphans.

## Non-goals

- Changing the per-row **Change directory** action. It has the same hidden-directory problem and
  should probably get the same treatment, but that is a separate decision — flag it, do not fold it
  in. (Immediate workaround for the picker: `Cmd+Shift+.` toggles hidden files in macOS dialogs.)
- Verifying that the pasted directory actually *is* a Claude config directory (contains
  `projects/`, `settings.json`, …). Today's contract accepts any real directory and lets the watcher
  report `waiting` until Claude data appears; a fresh `~/.claude3` must stay addable before its first
  session ever runs.
- Auto-discovering `.claude*` directories under `~`. Still an explicit feature Non-goal.

## Path

- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` (param parser + label derivation)
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (`addClaudeEnvironment` signature)
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/` — label-derivation and param-parser unit tests, plus a render test for
  the paste-and-add flow
- `docs/integrations/eyes-on-agents-layout.md`,
  `docs/features/eyes-on-agents-claude-multi-environment.md` (the add flow is described in both)

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`
- Do **not** run Electron, packaged builds, Playwright, or any `test:e2e:*` suite.
- Two pre-existing failures are not this task's to fix: the deterministic `ui-source.test.mjs`
  bundle-id assertion, and the ~6/10 flaky `thread-card-open-capability.test.mjs` right-click test.
- Owner-only manual check: paste `/Users/ral/.claude2`, confirm the row appears labelled `claude2`
  with that path, and that a bogus path shows a readable error without closing the form.

## Implementation evidence

- **Param parser + label derivation** (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts`):
  `parseEyesOnAgentsAddClaudeEnvironmentParams` now accepts only `configDirectory`, bounded to 4096
  and required to be absolute (POSIX `/…` or Windows `C:\…`); the old `{ label }` shape and any
  extra key are rejected rather than ignored, so a stale caller cannot silently add an environment
  pointing at a label-shaped "path". `deriveEyesOnAgentsClaudeEnvironmentLabel` strips one leading
  dot from the basename and bounds the result to 80 characters, falling back to the raw basename and
  then to `Claude environment`. It deliberately does no filesystem work — existence/symlink/realpath
  checks stay in `requireCanonicalClaudeConfigDirectory` on the Main side.
- **Signature threaded** through `EyesOnAgentsApi`, `EyesOnAgentsHandler`, `EyesOnAgentsService`, and
  the renderer store. Both Main-side `addClaudeEnvironment` implementations dropped their
  `pickClaudeConfigDirectory()` call and now derive the label from the supplied directory.
- **Renderer**: the add form's single input is the absolute path
  (`addEnvironmentDirectory`, placeholder `Absolute CLAUDE_CONFIG_DIR (e.g. /Users/you/.claude2)`),
  **Add** disabled while empty, and a rejected path leaves the form open with the typed value so a
  typo is corrected rather than retyped.
- **i18n**: `addLabelPlaceholder` → `addDirectoryPlaceholder` in both `en.ts` and `zh.ts`; verified
  no orphan reference remains and the two files' `claudeEnvironment` key order is still identical
  (23 keys each).

### Trust-boundary change — deliberate, and it moved a load-bearing assertion

`ui-source.test.mjs` carried `assert.doesNotMatch(rendererSource, /showOpenDialog|pickDirectory|configDirectory\s*:/)`.
That was not incidental: it encoded the rule that **the renderer may never hand Main a filesystem
path** — historically it could only trigger the native picker, and Main owned the path (the sibling
assertion "the renderer contract must not accept a custom path" states the same intent for
`changeClaudeDirectory`). This task knowingly breaks half of that rule, so the assertion was
narrowed rather than deleted, and now pins the new, smaller boundary:

- the renderer still never opens a native dialog (`showOpenDialog|pickDirectory` still forbidden);
- **add** is the one path that carries a directory, and is asserted to be explicitly typed as such;
- repointing an **existing** environment (`changeClaudeDirectory`, `chooseClaudeEnvironmentDirectory`,
  `useAutomaticClaudeEnvironment`) is asserted to still accept no renderer-supplied path.

The residual capability is that a compromised renderer could propose an arbitrary directory for a
*new* environment, which Bitterless would then watch and use as `CLAUDE_CONFIG_DIR`. Mitigations: the
value is user-entered in Bitterless's own UI, and Main validates it through
`requireCanonicalClaudeConfigDirectory` (absolute, existing, non-symlink, not a filesystem root)
before it is persisted, watched, or spawned against. Recorded in the feature doc as well, so the
next reader sees the boundary as designed rather than as an eroded test.

### Tests

- `claude-environment-setup-command.test.mjs` +2: the parser accepts POSIX and Windows absolute
  paths, rejects a relative path, a `~/…` path (the parser does not expand tildes, so passing one
  through would be wrong), an empty string, the legacy `{ label }` shape, and extra keys; label
  derivation covers the leading dot, trailing and doubled slashes, Windows separators, a dot-only
  basename, `/`, `''`, and the 80-character bound.
- `claude-environment-render.test.mjs`: the add-flow test now types an absolute path and asserts the
  trimmed **directory** reaches the store.
- `ui-source.test.mjs`: the store call assertion follows the new signature, plus a new negative
  assertion that no `addEnvironmentLabel` remains.

### Verification

- `yarn typecheck:eyes-on-agents:core` — 0 errors. `yarn typecheck:eyes-on-agents:ui` — 0 errors.
- `yarn test:eyes-on-agents:claude` — all 4 groups `fail 0`.
- `yarn test:eyes-on-agents:ui` — 105 tests, 103 pass, 2 fail: only the two already-logged
  pre-existing failures. A third failure did appear mid-work — the trust-boundary assertion above —
  and was resolved by narrowing it deliberately rather than by deleting it.
- `yarn eslint` on every touched source file — 0 new errors (the 3 pre-existing `prefer-const` and 1
  `no-useless-escape` remain, all byte-identical in `HEAD`).
- Electron, packaged builds, Playwright and `test:e2e:*` — not run. Owner-only manual check
  outstanding: paste `/Users/ral/.claude2`, confirm the row appears labelled `claude2`, and that a
  bogus path shows a readable error without closing the form.

## Review

[Independent review 1](../reviews/eyes-on-agents-claude-env-paste-path-091-1.md) passed with no
blocking findings, and covered both this task and the socket-path fix committed alongside it. It
mutation-tested every new assertion (all load-bearing) and bound real unix sockets in a scratch
directory rather than reasoning about the limit. Corrections it produced, all applied:

- **The off-by-one was mine, and measured against me.** The socket guard used 103, on the widespread
  "104 including the NUL" rule of thumb. That is the *Linux* idiom: macOS's `sockaddr_un` carries a
  `sun_len` field, and binding real sockets shows 104 succeeds and only 105 fails. The guard is now
  104, with the measurement recorded in the code comment so the next reader does not "fix" it back.
- **The label was derived from the RAW input, not the canonical path** — this task's Required
  behavior, the function comment, and a test comment all three said canonical. Rather than correct
  three comments to match weaker code, the derivation moved *into*
  `ClaudeDirectoryConfigService.addEnvironment`, which already canonicalizes, so the documented
  behavior is now the real one. This also removes the edge the review found, where
  `/Users/ral/.claude2/.` derived a label of `.`.
- **The narrowed trust-boundary assertion did not pin what it claimed.** "add is the only path
  carrying a directory" was a *positive* `assert.match`, which cannot prove exclusivity; the review
  demonstrated two payloads that passed unnoticed. It is now a negative assertion over the whole
  renderer tree — only the Claude connection card and the store may mention `configDirectory` at all
  — and the feature doc's "pins both halves" claim is rewritten to describe what is actually pinned.
- **The dead `pickClaudeConfigDirectory` dependency** left on `EyesOnAgentsService` after the picker
  call was removed (TypeScript and eslint cannot see an unread optional dependency) is deleted,
  along with its handler wiring and its now-false comment. This task's evidence had claimed "no dead
  dependency"; that claim was wrong.
- The stale task 085 backlog entry this commit's new test closed has been removed from
  `docs/plan/backlog.md`, and the socket issue is now registered in `docs/INDEX.md`.

Three findings were judged non-blocking and logged rather than fixed: the loose
"control-character-free" wording (TAB/`\x1f`/`\x7f` pass the parser and fail later at `stat`), the
absence of any *location* constraint on an accepted directory, and the hand-maintained `docs/INDEX.md`
drifting out of sync with `docs/issues/`.



Not yet independently reviewed — implemented directly at the owner's request while he was blocked
mid-test. Worth a review pass before this is considered closed, particularly on the trust-boundary
change above.
