---
id: eyes-on-agents-iterm2-renderer-083
scope: Add an independent Open-in-iTerm2 action to the EyesOnAgents thread card without changing the existing primary Open button
status: done
depends-on: [eyes-on-agents-iterm2-backend-082]
verify: focused EyesOnAgents UI-source/store tests, renderer i18n check, UI strict typecheck; no Electron; manual iTerm2 verification is owner-only
---

# EyesOnAgents iTerm2 Renderer

## Objective

Expose the new `openThreadInIterm2` XPC method as an independent dropdown action on
`ThreadCard.vue`, visible only when a thread carries an `iterm2SessionId`, without altering the
existing `canOpenThread` / `openLabel` / `handleOpen` primary-Open contract.

## Context

- `docs/features/eyes-on-agents-iterm2-open.md` — "Renderer" section defines the exact contract for
  this task, including why the primary Open button and its computeds stay untouched.
- `docs/integrations/eyes-on-agents-layout.md` — existing card/dropdown layout this action is added
  into.

## Required behavior

- `canOpenThread` (`ThreadCard.vue` around line 174-175) and `openLabel` (around line 190-192) are
  not modified.
- A new computed `canOpenInIterm2 = props.thread.iterm2SessionId !== null` gates a new entry in the
  existing `a-dropdown` (around line 59) alongside **Copy session path** and the read-state toggle.
- A new `handleOpenInIterm2` calls a new store method
  `eyesOnAgentsStore.openThreadInIterm2(props.thread.sessionKey)`
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`), mirroring the existing
  `openThread` method's error-swallowing `.catch(() => undefined)` pattern used by `handleOpen`.
- New i18n keys `eyesOnAgents.actions.openInIterm2` are added to both
  `src/renderer/common/i18n/en.ts` ("Open in iTerm2") and `src/renderer/common/i18n/zh.ts`
  ("在 iTerm2 中打开"), following the existing `openInClaude` / `openInCodex` key placement.
- A CLI-only Claude row (no `desktopSessionId`, `iterm2SessionId` present) renders its card because
  of the visibility change already shipped in task 082; this task must confirm `canOpenThread`
  remains `false` for such a row (no primary Open button, no Enter-key/double-click open) while the
  new dropdown action is available and functional.
- A row with both `desktopSessionId` and `iterm2SessionId` shows the unchanged primary Open button
  and the new dropdown action at the same time.

## Path

- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/thread-card-open-capability.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs` (or a new focused test file if the existing ones are a
  poor fit)
- `docs/integrations/eyes-on-agents-layout.md` (add the new dropdown entry to the card action
  inventory if that doc enumerates them)

## Verification

- New/extended UI-source tests cover: `canOpenInIterm2` true/false against `iterm2SessionId`
  presence; `canOpenThread` is unaffected by `iterm2SessionId` in every combination with
  `desktopSessionId` and `provider`; the dropdown renders the new action only when
  `canOpenInIterm2` is true.
- A store-level test confirms `openThreadInIterm2` calls the new XPC method with the correct
  `sessionKey` and swallows a rejected promise the same way `openThread` does.
- Run `yarn test:eyes-on-agents:ui`, `yarn check:renderer-i18n`, `yarn typecheck:eyes-on-agents:ui`,
  and `git diff --check`.
- Do not launch Electron. The real-iTerm2 reveal check from
  `docs/features/eyes-on-agents-iterm2-open.md`'s Acceptance section is owner-only manual
  verification and is explicitly out of scope for this task's automated verification; note it as
  not run rather than attempting to simulate it.

## Implementation evidence

- `ThreadCard.vue` gains a new computed `canOpenInIterm2 = props.thread.iterm2SessionId !== null`
  immediately after the unmodified `canOpenThread`, and a new `handleOpenInIterm2` immediately after
  the unmodified `handleOpen`. `handleOpenInIterm2` mirrors `handleCopySessionPath`'s shape exactly
  (`await eyesOnAgentsStore.openThreadInIterm2(props.thread.sessionKey).catch(() => undefined);`) —
  no internal guard, because the store method itself validates `iterm2SessionId !== null` and the
  dropdown entry is already `v-if="canOpenInIterm2"` gated, the same defense-in-depth split the
  existing Copy-session-path action already uses. A new `<a-doption v-if="canOpenInIterm2">` (icon
  `IconTerminal2`, label `eyesOnAgents.actions.openInIterm2`, disabled while
  `eyesOnAgentsStore.openingSessionKeys.has(thread.sessionKey)`) is inserted directly after the
  existing provider-named Open item and before the read-state toggle. `canOpenThread` (line ~174) and
  `openLabel` (line ~190) are byte-for-byte unchanged; the existing `a-doption v-if="canOpenThread"`
  block was not touched, only appended-after.
- `eyesOnAgents.store.ts` gains `openThreadInIterm2(sessionKey)` immediately after the unmodified
  `openThread`, structurally identical to it: resolves the thread by `sessionKey`, returns early when
  `iterm2SessionId === null` or a same-session open is already in flight, reuses the same
  `openingSessionKeys` in-flight set (so a concurrent Desktop-open and iTerm2-open for the same row
  cannot race each other), calls `eyesOnAgentsEmitter.openThreadInIterm2({ sessionKey })`, applies the
  returned snapshot, and on failure sets `actionError` and rethrows — exactly `openThread`'s contract,
  which is what lets the component's `.catch(() => undefined)` be the thing that actually swallows the
  rejection (the store method itself does not swallow; it rethrows for the caller to decide, matching
  `openThread`). `openThread` itself is unmodified.
- `en.ts` / `zh.ts` gain `eyesOnAgents.actions.openInIterm2`: `'Open in iTerm2'` / `'在 iTerm2 中打开'`,
  placed immediately after `openInClaude` in both files, matching the existing `openInCodex` /
  `openInClaude` placement precedent.
- `scripts/eyes-on-agents/thread-card-open-capability.test.mjs`: `createThread()`'s default fixture
  gained `iterm2SessionId: null` — without this default, every existing thread fixture would have
  `iterm2SessionId === undefined`, and `undefined !== null` is `true`, which would have made
  `canOpenInIterm2` incorrectly `true` on every pre-existing test row (the same fixture-drift class of
  bug task 082's evidence recorded for its own `persistedThread()` helper). `createStore()` gained an
  `openThreadInIterm2` stub tracked in `calls.openIterm2`. Three new tests were added: a CLI-only
  Claude row with only `iterm2SessionId` set renders the new dropdown action while Enter/double-click
  stay no-ops and no primary Open item appears; a row with both `desktopSessionId` and
  `iterm2SessionId` renders both open actions simultaneously and each calls only its own store method;
  and a parametrized sweep over `provider × desktopSessionId × iterm2SessionId` confirms
  `canOpenThread`'s `tabindex` outcome never changes based on `iterm2SessionId`. No existing assertion
  in this file was altered beyond the new default field.
- `scripts/eyes-on-agents/focus-board-store.test.mjs` (the one `:ui`-suite file that bundles and
  exercises the real `eyesOnAgents.store.ts`, not a stub) gained an `openThreadInIterm2` harness stub
  and fixture field, plus one new `context.test` that calls the real store method: a success call
  invokes the harness with the exact `sessionKey` and never touches the Desktop `openThread` harness
  call; a forced rejection propagates out of `store.openThreadInIterm2` (mirroring `openThread`'s
  rethrow) and sets `actionError`, and wrapping that same call in `.catch(() => undefined)` — the
  literal pattern `handleOpenInIterm2` uses — swallows it without further throwing. This is the
  "store-level test" the Verification section asked for; `thread-card-open-capability.test.mjs` only
  exercises the component against a fully mocked store, so it cannot cover the real emitter-call/
  error-rethrow contract.
- `docs/integrations/eyes-on-agents-layout.md`'s card action inventory bullet (overflow menu items,
  in order) gained an entry for the new independent **Open in iTerm2** action, present whenever a
  Claude row carries `iterm2SessionId`, explicitly noting neither open item hides or replaces the
  other. No other line in that document was changed.
- `docs/features/eyes-on-agents-iterm2-open.md` needed no naming/shape correction: the "Renderer"
  section's `canOpenInIterm2`, `handleOpenInIterm2`, and `openThreadInIterm2` signatures match the
  implementation exactly, so it was not edited.

### Acceptance-criterion gap found but not owned by this task

`docs/integrations/eyes-on-agents-layout.md` still states in two places — the "folder/overflow"
bullet ("Claude rows without a trusted Desktop Open route do not render") and the keyboard-focus
paragraph ("Claude rows without that trusted Desktop route are Main-private inventory and do not
render in Focus or modal search results") — a visibility rule that task 082 already changed in code
(`getSnapshot()`'s filter now also admits a row whose only identity is `iterm2SessionId`). This is a
documentation gap left by task 082 (which updated `eyes-on-agents-iterm2-open.md` and
`eyes-on-agents.md` but not `eyes-on-agents-layout.md`'s older visibility prose), not something this
task's objective (wiring the new dropdown action) touches or is responsible for closing. Flagging it
here rather than editing it, per this task's instruction not to expand scope backward into
already-committed work.

## Verification evidence

- `yarn test:eyes-on-agents:ui` — 75 passed, 0 failed (includes the new/extended coverage in
  `thread-card-open-capability.test.mjs` and `focus-board-store.test.mjs`).
- `yarn typecheck:eyes-on-agents:ui` — passed.
- `git diff --check` — clean, no output.
- `yarn check:renderer-i18n` — **fails, but on a pre-existing, unrelated defect confirmed via
  `git stash` to reproduce identically with none of this task's changes applied.** The script crashes
  at its `assert(trayCreateIndex > homeCreateIndex, 'Tray must follow Home creation')` check
  (`scripts/renderer-i18n/check-renderer-i18n.mjs:172`) because it looks for the literal substring
  `trayHelper.init(mainWindowHelper)` in `src/main/app.main.ts`, but commit `6caec1a` ("feat: advance
  Maestro and OnlyPreview workflows") changed that call to `trayHelper.init({ ... })` without updating
  this check script. This is unrelated to EyesOnAgents, iTerm2, or renderer i18n keys — the script
  never reaches its i18n-content assertions. This task's actual i18n change (the single
  `openInIterm2` key added identically to both `en.ts` and `zh.ts` at the same nesting depth) is
  exercised and passes through `yarn test:eyes-on-agents:ui`'s rendered-DOM assertions (the new
  dropdown option renders the correct localized English text in
  `thread-card-open-capability.test.mjs`). Fixing the unrelated `app.main.ts`/check-script drift is
  out of this task's scope and was not attempted.
- Electron, packaged-app, and end-to-end tests were not run, per this task's explicit instruction; the
  real-iTerm2 reveal check from the feature doc's Acceptance section remains owner-only manual
  verification.

## Review

[Independent review 1](../reviews/eyes-on-agents-iterm2-renderer-083-1.md) passed with no blocking
findings. It confirmed the `check:renderer-i18n` failure reproduces identically on the clean
pre-task-083 tree (genuinely pre-existing) but corrected the root-cause commit citation above from
`6caec1a` to `c67ac21` — the substance of the finding (script crashes on an unrelated tray/Home
startup-ordering assertion before reaching any i18n content check) is unaffected. It also confirmed,
line by line, that every feature-doc Acceptance bullet except the explicitly owner-only manual
iTerm2 reveal check is satisfied by the combined 081+082+083 state, and found three stale sentences
in `docs/integrations/eyes-on-agents-layout.md` left over from task 082's visibility change (two the
task 083 developer had already found, one more at the States table's `Claude CLI-only inventory`
row); all three are corrected in this same commit. Non-blocking findings are recorded in
`docs/plan/backlog.md`.
