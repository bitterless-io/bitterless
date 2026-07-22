---
id: todo-subtodo-count-map-003-1
target: working-tree-2026-07-22
compared_with: todo-subtodo-count-map-003
---

# Verdict

**PASS. No P1, P2, or P3 finding was identified.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Evidence

- `src/main/todoistSync/todoistSync.repository.ts:654` retains the existing validated,
  order-preserving deduplication through `uniqueIds`; empty input still returns `{}`. The producer
  initializes every unique requested ID to `{ total: 0, done: 0 }` before applying SQL aggregate
  rows, and the parameterized `IN` query can return rows only for requested IDs. The resulting map
  therefore has exactly one entry per unique requested ID.
- The aggregate remains scoped to the active customer and includes only live, reconciled SubTodos.
  Populated Todos retain their SQL-derived `total` and `done` values while requested Todos without
  matching rows keep explicit zero values.
- No renderer source changed. `src/renderer/todo/src/store/todoResult.guard.ts:50` still rejects
  transport `null`, malformed values, and every omitted requested key through `Object.hasOwn`;
  `src/renderer/todo/src/store/todo.store.ts:253` still applies that guard before updating renderer
  SubTodo counts. The existing omitted-key regression at
  `scripts/todoist-sync/native.test.ts:560` remains intact and passed.
- The new regression at `scripts/todoist-sync/native.test.ts:835` covers a duplicate requested ID,
  one Todo with no SubTodos, one Todo with one incomplete and one completed SubTodo, and empty
  input. It uses `createRuntime`, which constructs the production `TodoistSyncDatabase` and
  `TodoistSyncRepository` against a temporary customer database with the fixed test password.
  `TodoistSyncDatabase` imports `better-sqlite3-multiple-ciphers`, enables SQLCipher, applies the
  real migrations, and performs integrity checks; no repository or SQL executor mock participates
  in this regression.

# Verification

- `yarn typecheck:todoist-sync` — passed.
- `yarn test:todoist-sync` — passed, 27/27 tests including the new real-repository dense-count test
  and the existing renderer omitted-key guard test.
- `yarn typecheck:todo-web` — passed.
- `git diff --check` — passed.
