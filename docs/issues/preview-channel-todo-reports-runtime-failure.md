# Preview Reports a Missing Sign-In as a Local Data Runtime Failure

Status: fixed; owner verification pending

## Symptom

On the Preview channel (`Bitterless Preview`, profile `production-preview`) the Todo board opens and
immediately shows:

```text
Todo is unavailable. Its local data runtime could not be opened.
```

The wording accuses local SQLite. Local SQLite is healthy in that install.

## Evidence

`~/Library/Logs/Bitterless_PREVIEW/main.log`, 2026-09-01:

```text
05:18:01 renderer:sqlite sqlite   opening database: …/Bitterless_PREVIEW/db/main.db
05:18:01 renderer:sqlite sqlite   database initialized
05:18:48 renderer:home   error in HomeShellBridgeHandler/openTodo
                         Error: Todo runtime requires an authenticated customer
07:45:45 renderer:sqlite error in TodoistSyncTodoHandler/getAll
                         Error: [todoist sync] no eligible customer session is active
07:45:45 renderer:sqlite error in TodoistSyncTodoHandler/getSortOrder
                         Error: [todoist sync] no eligible customer session is active
07:45:45 renderer:todo   renderer initialization failed:
                         Error: [todo] domain list returned an invalid required result
```

Supporting state in the same install:

- `…/Bitterless_PREVIEW/Local Storage` holds `bitterless-desktop-device-id` and `sqk` but **no**
  `bitterless-desktop-token`; the Stable profile holds the token.
- `…/Bitterless_PREVIEW/todoist-sync/` holds only `clock-state.json` — the per-customer sync
  database was never created, so no session was ever activated.

## Root cause

Three separate misattributions stack on top of one expected condition.

1. **Expected condition.** The Preview channel owns its own `userData`, therefore its own renderer
   `localStorage`, therefore its own customer session. Preview shares the production API but not the
   Stable sign-in. An install that has never signed in has no Core token, so
   `authStore.ensureTodoistSyncReady()` refuses and the Todo sync runtime is never activated. This
   is the documented Preview persistence boundary working as designed.

2. **The Todo window bypasses the only auth gate.** `ensureTodoistSyncReady()` runs only in
   `HomeShellBridgeHandler.openTodo`. `TodoWindowHandler.openTodoWindow()` is an unguarded XPC Main
   method, so the tray and the Omni Todo cell open the board with no session at all.

3. **The error identity is lost twice on the way to the user.** The preload handler throws
   `[todoist sync] no eligible customer session is active`, but electron-xpc resolves the caller
   with `undefined` instead of rejecting, so `requireArray` reports a *shape* error
   (`[todo] domain list returned an invalid required result`). `App.vue`, the home `Todo.vue`
   placeholder, and `observeTodoMutation` then map every initialization or mutation failure to the
   single string `i18nHelper.todo.runtimeUnavailable`, which names the local data runtime.

The user therefore receives a storage-corruption message for a sign-in state, with no next step.

## Repair contract

- Todo distinguishes "no eligible customer session" from "the local data runtime could not be
  opened" and shows a sign-in message naming the action the owner must take.
- The classification is authoritative, not heuristic: the standalone/Omni Todo renderer reads
  `TodoistSyncStatusHandler.getStatus().active`; the home placeholder reads the already-known
  `authStore.current`. `getStatus()` never throws and `getRepositoryAsync()` awaits an in-flight
  activation, so an activating session is never misreported as a missing one.
- Initialization failures and mutation failures use the same classification, so the board and its
  write path cannot disagree.
- A probe that itself fails degrades to the existing runtime message; no failure path becomes
  silent.
- Both languages carry the new key; no user-facing string is hardcoded.
- Sign-in, activation, sync, and SQLite behavior are unchanged. This issue changes attribution and
  wording only.

Delivery: [todo-session-required-attribution-016](../plan/tasks/todo-session-required-attribution-016.md).
