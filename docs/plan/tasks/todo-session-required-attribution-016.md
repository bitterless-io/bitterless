---
id: todo-session-required-attribution-016
scope: Todo reports a missing customer session as a sign-in requirement instead of a local data runtime failure
status: implemented; owner verification pending
depends-on: [todo-sync-runtime-recovery-002, todo-renderer-refresh-stability-011]
---

# Todo Sign-In Attribution

## Objective

Stop the Todo board from blaming local SQLite when the real condition is that this install has no
eligible customer session — the normal state of a fresh Preview or Development channel install.

## Required behavior

1. Add one new user-facing key `todo.sessionRequired` to `en.ts` and `zh.ts`, naming the action:
   sign in to Bitterless in this application's main window.
2. Add `src/renderer/todo/src/store/todoSessionState.service.ts` exposing
   `resolveTodoUnavailableReason(probe)`. It returns `'sessionRequired'` when the injected probe
   reports `active === false`, otherwise `'runtimeUnavailable'`. It returns a key, not a string, and
   imports neither Vue, i18n, nor XPC, so it is directly executable under `node --test`.
3. A failing probe logs a sanitized warning and returns `'runtimeUnavailable'`. The probe never
   throws into the caller.
4. `src/renderer/todo/src/App.vue` initialization failure and
   `src/renderer/todo/src/store/todoMutation.service.ts` mutation failure both resolve the reason
   from `todoistSyncStatusEmitter` and render `i18nHelper.todo[reason]`, so the board and its write
   path cannot disagree.
5. `src/renderer/home/src/views/todo/Todo.vue` classifies from the state it already owns: no
   `authStore.current` means `todo.sessionRequired`; any other failure keeps
   `todo.runtimeUnavailable`. It performs no extra XPC call.
6. Mutation failure recovery, refresh scheduling, sync activation, clock checking, and SQLite
   behavior are unchanged.

## Expected paths

- `docs/INDEX.md`
- `docs/issues/preview-channel-todo-reports-runtime-failure.md`
- `docs/plan/README.md`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/todo/src/store/todoSessionState.service.ts`
- `src/renderer/todo/src/store/todoMutation.service.ts`
- `src/renderer/todo/src/App.vue`
- `src/renderer/home/src/views/todo/Todo.vue`
- `scripts/todo/todo-session-attribution.test.mjs`
- `package.json`

## Verification

- `yarn test:todo-session-attribution` executes the classifier and proves: an inactive session
  resolves `sessionRequired`, an active session resolves `runtimeUnavailable`, and a throwing probe
  degrades to `runtimeUnavailable` with exactly one warning.
- Source coverage proves `App.vue`, `todoMutation.service.ts`, and the home `Todo.vue` no longer
  reference `todo.runtimeUnavailable` unconditionally.
- `yarn check:renderer-i18n` proves the new key exists in every language.
- `yarn typecheck:web` and `yarn typecheck:todo-web` pass.
- Electron E2E is excluded.
