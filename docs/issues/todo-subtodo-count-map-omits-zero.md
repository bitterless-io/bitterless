# Todo batch SubTodo count map omits new Todos with zero rows

状态：已修复

Implementation: [todo-subtodo-count-map-003](../plan/tasks/todo-subtodo-count-map-003.md)

## Report

After creating a Todo without any SubTodo, the `todo/data_updated` subscriber calls `loadAll()` and
fails with:

```text
[todo] SubTodo count map omitted required key <todo-id>
```

The new Todo is committed, but the renderer refresh aborts while loading its SubTodo count.

## Confirmed cause

`TodoistSyncRepository.getCountsByTodoIds()` uses `GROUP BY todo_id`. SQL returns rows only for
Todos that currently have at least one live, reconciled SubTodo, so the returned map is sparse.
The strict renderer result guard correctly requires a count for every requested Todo and exposes
the mismatch. Before that guard existed, the renderer silently converted an omitted key to zero.

## Required correction

Make the repository batch API dense: initialize every unique requested Todo ID to
`{ total: 0, done: 0 }`, then overwrite entries returned by the aggregate query. Keep the renderer
strict: `null`, malformed counts, or an omitted requested key remain failures.

## Acceptance

- A newly created Todo with no SubTodo receives `{ total: 0, done: 0 }` in the batch result.
- A mixed batch returns zero for the empty Todo and real counts for a Todo with SubTodos.
- The renderer refresh guard continues to reject an actually omitted requested key.
- Focused Todo sync typecheck/native tests and `git diff --check` pass.

## Resolution — 2026-07-22

`TodoistSyncRepository.getCountsByTodoIds()` now initializes every unique requested Todo ID to
`{ total: 0, done: 0 }` before applying the grouped SQL rows. The renderer guard remains unchanged,
so a transport `null`, malformed count, or genuinely incomplete producer result still fails.

A real encrypted repository regression covers an empty Todo, a Todo with two SubTodos including one
completed item, a duplicate request ID, and empty input. Independent review passed with no P1/P2/P3.
