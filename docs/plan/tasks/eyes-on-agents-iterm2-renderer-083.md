---
id: eyes-on-agents-iterm2-renderer-083
scope: Add an independent Open-in-iTerm2 action to the EyesOnAgents thread card without changing the existing primary Open button
status: pending
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
