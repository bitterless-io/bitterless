---
id: todo-subtodo-count-map-003
scope: make Todoist-sync SubTodo batch counts dense for newly created Todos with zero SubTodos
status: done
depends-on: [todo-sync-runtime-recovery-002]
---

# Objective

Stop `todo/data_updated` refresh from failing after a Todo is created without SubTodos. Preserve the
strict renderer boundary by making the Main repository return an explicit zero count for every
requested Todo ID instead of weakening missing-required-data validation.

# Context

- `docs/issues/todo-subtodo-count-map-omits-zero.md`
- `docs/features/todoist-sync.md`
- `docs/plan/tasks/todo-sync-runtime-recovery-002.md`

# Path

- `src/main/todoistSync/todoistSync.repository.ts`
- `scripts/todoist-sync/native.test.ts`
- the referenced docs and review artifact

# Implementation contract

- `getCountsByTodoIds()` validates and deduplicates the request as today.
- Its result contains exactly one entry for each unique requested ID. Empty input remains `{}`.
- Every requested ID starts at `{ total: 0, done: 0 }`; aggregate rows replace only their matching
  entries. The renderer continues to reject missing keys and malformed or transport-null results.
- No Todo/SubTodo row, outbox command, event, sync state, or renderer optimistic state changes.

# Verification

- Native repository regression with one zero-SubTodo Todo and one Todo containing mixed completed
  and incomplete SubTodos;
- existing renderer result-guard regression still rejects an omitted required key;
- `yarn typecheck:todoist-sync`;
- `yarn test:todoist-sync`;
- `yarn typecheck:todo-web`;
- `git diff --check`.

# Completion — 2026-07-22

- The repository now produces exactly one count entry for every unique requested Todo ID. SQL
  aggregate rows overwrite explicit zero defaults; empty input remains `{}`.
- The real SQLCipher regression covers duplicate IDs, a new Todo with no SubTodo, and a second Todo
  with two SubTodos where one is completed. Its dense result is respectively `0/0` and `2/1`.
- The renderer strict missing-key regression was preserved; no renderer fallback or Todo mutation
  behavior changed.
- `yarn typecheck:todoist-sync`, `yarn typecheck:todo-web`, and `git diff --check` passed.
- `yarn test:todoist-sync` passed 27/27.
- Independent verification found no P1, P2, or P3. See
  [todo-subtodo-count-map-003-1](../reviews/todo-subtodo-count-map-003-1.md).
