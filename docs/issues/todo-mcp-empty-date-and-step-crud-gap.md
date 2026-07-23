# Todo MCP empty-date rejection and missing Step CRUD

Status: fixed

Implementation: [todo-mcp-step-crud-009](../plan/tasks/todo-mcp-step-crud-009.md)

## Report

An agent's first `todo.create` attempt included empty optional date values. Public MCP parameter
validation rejected the request before Bitterless created a Todo. Retrying safely requires removing
the empty fields and checking the target Domain for an already-created duplicate first.

The same public MCP surface can create and edit a Todo but cannot list, add, edit, complete, reopen,
or delete one of its Steps even though the synchronized Todo runtime already stores these rows as
SubTodos.

## Confirmed cause

- `todo.create` and `todo.update` declare `dueAt` and `remindAt` as integer Unix milliseconds or
  `null`. An empty string is not a date and is correctly rejected by the MCP client's schema gate,
  so the rejected call never reaches the local bridge or repository.
- The Bridge currently checks only `Number.isInteger`. A raw client can therefore supply a negative
  or unsafe integer: the base Todo may be created first and the follow-up date update can then fail
  repository validation, leaving a partial creation. All optional fields must be validated before
  the base create and timestamps must be safe, nonnegative integers.
- The portable skill shows all optional create fields in its primary example and does not explicitly
  require omission of unspecified date fields or a duplicate check before retrying a create.
- `TodoistSyncRepository` already implements synchronized SubTodo create/list/get/title-update,
  status-toggle, and soft-delete operations. `mcpStdio.helper.ts` and `mcpBridge.server.ts` expose no
  corresponding public Step tools.

## Required correction

- Keep invalid date strings fail-closed. Describe optional dates as safe, nonnegative integer Unix
  milliseconds; omit the field when unspecified, and use `null` only to clear an existing date
  through `todo.update`. Continue accepting legacy create-time `null` as unspecified without
  issuing a second update.
- After any rejected or ambiguous `todo.create`, call `todo.list` for the resolved Domain and do not
  retry when an obvious active duplicate exists. Otherwise retry once with only valid fields.
- Expose `step.list`, `step.create`, `step.update`, `step.complete`, `step.uncomplete`, and
  `step.delete` through the public MCP surface. Completion operations must be idempotent rather than
  exposing the repository's toggle primitive.
- Update and version the complete portable `bitterless-todo` skill so Codex and Claude Code can
  decide when one Todo should carry multiple independently checkable Steps and can safely target a
  specific Step by ID.

## Acceptance

- Tool metadata tells agents never to send empty date strings and focused tests retain schema-level
  rejection of them.
- Negative and unsafe timestamps fail before `TodoistSyncRepository.createTodo` is called.
- The full Step lifecycle persists through the real synchronized repository boundary and returns
  validated rows/confirmations.
- A repeated `step.complete` or `step.uncomplete` call is a no-op success with the requested state.
- Missing parents/Steps, malformed IDs, empty titles, overlong titles, and ignored repository writes
  fail closed.
- Skill source, exported ZIP, workspace copies, and the installed Codex copy carry one new hard-coded
  `version_code` and pass YAML/package validation.

## Resolution

- Optional Todo timestamps are now safe, nonnegative integers. The bridge validates them and all
  other optional create fields before creating the base row; legacy create-time `null` is treated
  as omitted without a follow-up update.
- The public bridge now exposes the complete Step lifecycle with validated persisted results and
  deterministic, idempotent completion setters.
- The smoke CLI exercises Step create/list/update/repeated complete/repeated reopen/delete and
  ownership-safe cleanup. A native SQLCipher repository regression proves exact synchronized
  outbox/version behavior and no extra command for repeated status assignment.
- Portable skill revision `260723121906` omits empty dates, checks for duplicates before a bounded
  retry, distinguishes ambiguous execution from validation rejection, and teaches Todo-versus-Step
  judgment.

Verification and independent findings are recorded in
[todo-mcp-step-crud-009 round 1](../plan/reviews/todo-mcp-step-crud-009-1.md).
