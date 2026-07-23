---
id: todo-mcp-step-crud-009
scope: safe optional-date create recovery and synchronized Step CRUD through Todo MCP
status: done
depends-on: [todo-mcp-domain-catalog-skill-version-007, todoist-sync-desktop-001]
---

# Todo MCP Step CRUD and safe create retry

## Objective

Make the public Todo MCP expressive enough to manage a Todo's independently checkable Steps, and
prevent an agent from repeating a non-idempotent Todo creation after an invalid optional date field
without first checking for a duplicate.

## Context

- `docs/issues/todo-mcp-empty-date-and-step-crud-gap.md`
- `docs/features/todo-mcp.md`
- `docs/features/todoist-sync.md`
- `skills/bitterless-todo/`

## Implementation contract

### Optional Todo dates and retry

- `dueAt` and `remindAt` remain optional safe, nonnegative integer Unix-millisecond timestamps.
  `todo.create` omits an unspecified date and never sends `""`; legacy create-time `null` remains
  accepted as unspecified but does not trigger a second repository update. `todo.update` may use
  `null` to clear an existing date.
- Public tool descriptions and the portable skill state this distinction directly.
- Date, importance, note, and title validation completes before the base Todo is created, so an
  invalid follow-up field cannot leave a partial Todo.
- `todo.create` remains non-idempotent because identical intentional Todos are valid. After a clear
  parameter-validation rejection, the agent lists active Todos in the resolved Domain, compares
  normalized title and relevant context, and retries at most once only when no obvious duplicate
  exists. After a timeout, disconnect, or missing response, it waits and rechecks for a delayed
  commit before deciding whether another write is safe; one immediate empty list is not enough
  evidence to retry.

### Step tools

- `step.list({ todoId })` returns the validated parent Todo and every live reconciled Step in stable
  repository order.
- `step.create({ todoId, title })` trims a 1–200 character title and returns the persisted Step.
- `step.update({ id, title })` changes only the trimmed title, rereads the row, and returns it.
- `step.complete({ id })` and `step.uncomplete({ id })` are idempotent and use a deterministic
  repository status setter. The public tools never implement state assignment as get-then-toggle,
  which could reverse a concurrent human or remote update.
- `step.delete({ id })` verifies the existing row, performs synchronized soft deletion, verifies the
  live row is gone, and returns the deleted Step and parent Todo IDs.
- Every Step row is validated for a 20-digit ID, parent ID, customer ownership fields, status,
  position, timestamps, and live deletion state before it crosses the public MCP boundary.
- No direct SQLite access, new sync command, backend endpoint, or database migration is introduced.

### Portable skill

- Teach when a Todo should remain atomic versus contain multiple Steps; never turn agent-internal
  execution into personal Todo Steps.
- Require `step.list` before editing/deleting an unknown Step and before retrying `step.create`.
- Document every Step tool argument and result in `references/tools.md`.
- Bump the hard-coded Todo skill `version_code`, update matching tests, export the complete folder,
  and additively synchronize `.agents`, `.claude`, and `~/.codex` copies.

## Path

- `src/main/mcp/mcpStdio.helper.ts`
- `src/main/mcp/mcpBridge.server.ts`
- `scripts/mcp/`
- `skills/bitterless-todo/`
- `src/shared/mcp/todoAgentSkillVersion.shared.ts`
- `scripts/todo/todo-agent-skill-version.test.mjs`
- `.agents/skills/bitterless-todo/`
- `.claude/skills/bitterless-todo/`
- `~/.codex/skills/bitterless-todo/`
- the referenced issue, index, review, and release notes

## Verification

- focused MCP metadata and Step lifecycle tests;
- `yarn typecheck:mcp`;
- `yarn test:mcp:todo-step-crud`;
- `yarn test:mcp:multi-instance`;
- `yarn test:mcp:todo-smoke`;
- `yarn test:mcp:agent-onboarding`;
- `yarn test:mcp:todo-skill-export`;
- `yarn test:todo:agent-skill-version`;
- skill YAML/frontmatter and three-copy byte-equivalence checks;
- `git diff --check`;
- independent review before macOS ARM packaging.

## Result

- Public MCP now exposes `step.list`, `step.create`, `step.update`, `step.complete`,
  `step.uncomplete`, and `step.delete`, with persisted rereads, parent/customer validation, and
  deterministic status assignment.
- Todo create validates every optional follow-up field before the base write. Empty, negative, and
  unsafe date values therefore cannot leave a partial Todo; create-time `null` remains a no-op only
  for compatibility.
- The portable skill revision is `260723121906`. Canonical, exported, workspace Codex/Claude, and
  installed Codex copies describe date omission, duplicate-aware retry, ambiguous-result handling,
  and Step targeting.
- The real encrypted repository regression proves Step add/title update/status update/delete each
  produce the expected synchronized projection and outbox command, while repeating the same status
  setter changes neither the projection version, device sequence, nor outbox.
- Review: [round 1](../reviews/todo-mcp-step-crud-009-1.md).

## Completion evidence

- `yarn test:mcp:todo-step-crud` — pass.
- `yarn test:mcp:todo-smoke` — pass.
- `yarn typecheck:mcp` and `yarn test:mcp:multi-instance` — pass.
- `yarn typecheck:todoist-sync` and `yarn test:todoist-sync` — pass, 38/38.
- `yarn test:mcp:agent-onboarding`, `yarn test:mcp:todo-skill-export`, and
  `yarn test:todo:agent-skill-version` — pass.
- Four skill trees are byte-identical and their YAML/frontmatter validates.
- `git diff --check` — pass.
