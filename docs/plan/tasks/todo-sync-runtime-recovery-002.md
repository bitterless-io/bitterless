---
id: todo-sync-runtime-recovery-002
scope: migrate observable Todo schema v1 and gate renderer access on the authenticated Todo session
status: done
depends-on: [todoist-sync-desktop-001]
---

# Objective

Restore existing DEBUG Todo databases without destructive reset and make Todo renderer startup fail
truthfully. Introduce the real v1-to-v2 compatibility checkpoint, preserve all synchronized/local
rows, wait for the current authenticated customer's Todo runtime only when Todo is opened, and stop
interpreting `electron-xpc` failure sentinels as empty data or the Domain capacity limit.

# Context

- `docs/issues/todo-sync-session-null-results.md`
- `docs/features/todoist-sync.md`
- `docs/plan/analysis/todoist-sync.md`
- `docs/plan/tasks/todoist-sync-desktop-001.md`

# Path

- `src/main/todoistSync/todoistSync.migration.ts`
- `src/main/todoistSync/todoistSync.database.ts`
- `src/renderer/home/src/stores/auth/`
- `src/renderer/home/src/views/todo/Todo.vue`
- `src/renderer/home/src/views/miniApp/MiniApp.vue`
- `src/renderer/todo/src/store/todo.store.ts`
- `src/renderer/todo/src/xpc/update.subscriber.ts`
- `src/renderer/todo/src/components/AddDomainButton/AddDomainButton.vue`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/todoist-sync/`
- `scripts/sqlite-migrations/`
- the referenced docs and review artifact

# Implementation contract

- Migration v1 describes the original pre-parent-reference schema. Migration v2 adds only
  `todo_sync_baselines.parent_resource_id` and `todo_sync_baseline_parent`. Its runner inspects the
  live table so a development database already carrying either object upgrades safely.
- Runtime and release audit assert the current v2 schema and the exact ordered two-entry ledger.
  No Todo data is reset, copied to `main.db`, hard-deleted, or bootstrapped from absence.
- Core authentication still commits before optional runtimes. Home deduplicates the current Todo
  activation promise, clears it across logout/account changes, retries a rejected activation when
  Todo is explicitly opened, and creates neither embedded nor standalone Todo content before it
  resolves.
- Required renderer results use explicit runtime validation. Arrays and records must have their
  declared shape; `null` fails. Domain create keeps `undefined` as the sole capacity outcome and
  treats `null` as runtime unavailable.
- Subscriber/on-mount failures are caught and reported or logged once; no unhandled rejection is
  introduced and no missing-data fallback silently empties the board.

# Verification

- encrypted pre-v2 v1 reopen with state/baseline sentinel preservation and exact v2 ledger;
- already-shaped v1-ledger upgrade, repeated current-v2 reopen, failed-v2 rollback, integrity, and
  foreign-key checks in the shared migration audit;
- activation deduplication/readiness/retry/logout fencing source or behavior tests;
- required-result and Domain-capacity regression coverage;
- `yarn typecheck:todoist-sync`;
- `yarn test:todoist-sync`;
- `yarn typecheck:sqlite-migrations`;
- `yarn test:sqlite-migrations`;
- `yarn audit:sqlite-migrations`;
- `yarn typecheck:todo-web`;
- `yarn check:todo-window-runtime`;
- `yarn build`;
- `git diff --check`.

# Completion — 2026-07-22

## Implemented

- Restored the immutable pre-parent schema-v1 definition and added the ordered
  `todoist-sync-v2-baseline-parent` migration. Existing encrypted v1 databases upgrade in place;
  state, baseline, projection, event, and outbox rows are not reset or deleted. The migration also
  accepts the already-shaped DEBUG v1-ledger database and validates the v2 column/index before it
  records the ledger entry.
- Made Todo activation an explicit result with customer, device, and session-generation identity.
  Home keeps login non-blocking, deduplicates the current activation, fences logout/account changes,
  retries a failed activation on explicit Todo entry, and waits before creating embedded or
  standalone Todo content.
- Added strict Todo renderer result guards. Required arrays/maps/records reject `null`; only
  `undefined` remains the Domain-capacity outcome. Domain/SubTodo void mutations and every Todo sort
  write accept only the successful `undefined` result, so a transport `null` cannot drive a local
  optimistic update.
- Added one `observeTodoMutation` boundary for detached UI work, covering drag/drop, throttled
  saves, focused selection, menu actions, clock actions, and Modal/Enter delete paths. It consumes
  both synchronous and asynchronous failure and shows the localized runtime-unavailable message.
- Added encrypted historic-v1 upgrade, activation lifecycle, malformed/null result, and live
  `unhandledRejection` regressions. The shared audit now covers ten Todo migration baselines,
  including both observed v2 column orders and failed-v2 rollback.

## Evidence

- `yarn test:customer-auth` passed 11/11.
- `yarn typecheck:todoist-sync` passed.
- `yarn test:todoist-sync` passed 26/26, including the encrypted v1-to-v2 upgrade and null-XPC
  unhandled-rejection case.
- `yarn typecheck:sqlite-migrations`, `yarn test:sqlite-migrations` (11/11), and
  `yarn audit:sqlite-migrations` passed; the audit reports 11 Core, 7 Maestro, and 10 Todo baselines.
- `yarn typecheck:todo-web`, `yarn check:renderer-i18n`, and
  `yarn check:todo-window-runtime` passed.
- `yarn build` passed and emitted `out/preload/todo.js` plus the Todo renderer bundle. The existing
  Vite dynamic/static router-import warning remains non-blocking.
- `git diff --check` passed.

## Review and handoff

Independent review initially found one P2: newly strict result guards could reject through detached
Todo mutation calls. After the unified observation boundary and regression were added, independent
re-review returned PASS with no P1/P2. See
[todo-sync-runtime-recovery-002-1](../reviews/todo-sync-runtime-recovery-002-1.md).

The Electron GUI was not launched. On the next DEBUG run, opening Todo must upgrade the existing
customer database automatically; Ral should verify the active board, Archived Domains, and one
Domain create/edit action. No database deletion or manual rebuild is required.

The Todoist-style HTTP sync engine, backend lifecycle, and real two-client convergence gate remain
complete; this recovery task does not redesign or restart that protocol. The next separately tracked
sync delivery item is [sqlite-migration-release-gate-001](sqlite-migration-release-gate-001.md):
packaged native-module, signing/notarization, and public artifact proof for macOS ARM64/x64 and
Windows x64.
