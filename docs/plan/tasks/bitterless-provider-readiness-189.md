---
id: bitterless-provider-readiness-189
scope: Bitterless LLM provider readiness from the app-account session; no pi-login path for it in Control
status: done
depends-on: []
---

# Bitterless provider is ready whenever the app account session is in main

## Objective

Implement the contract in `docs/issues/bitterless-provider-asks-to-sign-in-inside-chat.md` #契约:

1. `src/main/maestro/llm/maestroLlm.service.ts` `checkLlmProviderReady()` gets a `bitterless` branch (use
   `isBitterlessProvider` from `src/main/agent/runtime/bitterlessProvider.ts`): ready iff
   `customerSessionService.current` is non-null and `model` is one of the Bitterless presets
   (`LLM_PRESETS` entries with `provider === 'bitterless'`). Pure read: no `ModelRuntime.create()`, no lock,
   no network.
2. Main re-evaluates and broadcasts `coach/llm-config` when `customerSessionService` changes
   (`customerSessionService.subscribe`). Reuse the existing `getAndBroadcastLlmConfig()`; subscribe once
   (idempotent), never throw out of the listener (log and continue), and do not broadcast from a stale
   overlapping evaluation (a simple "latest wins" guard is enough). Find the right lifecycle owner for the
   subscription (where `MaestroLlmService` is created / initialized) and keep it minimal.
3. `src/renderer/maestro/control/src/ControlApp.vue`: for the `bitterless` provider the login card must not
   call `coach.loginLlm`. Its button re-validates the app-account session through
   `localHomeAuthStore.restoreSession()` (`src/renderer/maestro/localHome/src/localHomeAuth.store.ts`): success →
   Home re-pushes the token → config broadcast makes it ready; invalid session → Home clears it → Control's
   gate shows the login form. Any failure is caught and shown (use the existing `Message` usage in that file);
   no unhandled rejection. Codex keeps its existing `loginLlm` path unchanged. Keep the card's existing text.
4. `src/main/xpc/compaction.handler.ts` `resolveTarget()`: for a Bitterless target call
   `registerBitterlessProvider(modelRuntime)` before looking the model up, so manual compaction works on
   Bitterless sessions.
5. Docs: correct `docs/features/bitterless-model-provider.md` "Where it registers, and why there" (checkTarget
   has no callers; readiness is the pure session read above) and the matching code comment in
   `src/main/agent/runtime/piRuntimeAdapter.ts` near `createModelRuntime`; fix the stale comment in
   `src/main/maestro/llm/llmModels.ts` that says registration throws.

## Context

- `docs/issues/bitterless-provider-asks-to-sign-in-inside-chat.md`
- `docs/features/bitterless-model-provider.md`
- Cowork reference: `/Users/ral/Documents/projects/overmind/projects/micromeet-cowork/apps/cowork/src/main/llm/coworkLlm.service.ts`
  (`checkLlmProviderReady`, `ai-crms` branch)
- BL house rules (Overmind CLAUDE.md "bitterless" block): no `forEach`, static imports, alias imports,
  `import type`, semicolons where the file uses them (match each file's local style), ≤ 1 param XPC handlers.

## Path

- `src/main/maestro/llm/maestroLlm.service.ts` (+ its init owner if the subscription lives there)
- `src/renderer/maestro/control/src/ControlApp.vue`
- `src/main/xpc/compaction.handler.ts`
- `src/main/agent/runtime/piRuntimeAdapter.ts`, `src/main/maestro/llm/llmModels.ts` (comments only)
- `docs/features/bitterless-model-provider.md`
- New focused test under `tests/maestro/` (node:test, same bundling/stub style as neighbouring tests) covering:
  readiness true/false with/without session and without calling `ModelRuntime.create`; session change →
  exactly one `coach/llm-config` broadcast per change; Control's bitterless login action does not call
  `loginLlm` and calls `restoreSession`; compaction registers bitterless before lookup.

Do NOT touch the unrelated uncommitted files already in the worktree (`package.json`,
`src/main/maestro/common/shortcutsHelper/shortcuts.helper.ts`, `src/main/menu/applicationFindMenu.service.ts`,
`docs/issues/cmd-w-falls-through-to-the-menu-when-focus-is-nowhere.md`,
`tests/maestro/cmdWOwnsTheAccelerator.test.mjs`) — another session owns them.

## Verification

- New test passes: `node --test tests/maestro/<new-test>.test.mjs`.
- Neighbouring suites still pass: `node --test tests/maestro/controlLogin*.test.mjs tests/maestro/accountMenu.test.mjs`.
- `yarn typecheck:node` and `yarn typecheck:web` — report pre-existing diagnostics separately; no new ones in touched files.
- `yarn eslint <touched files>` clean for touched lines.
- No Electron launch / E2E, no commit, no branch operations.

## Result

Done 2026-09-24 — see the issue's #结果. [Review 1](../reviews/bitterless-provider-readiness-189-1.md): pass
(F1–F5 non-blocking; F1/F4/F5 → backlog, F2 → separate task, F3 → doc wording fixed).
