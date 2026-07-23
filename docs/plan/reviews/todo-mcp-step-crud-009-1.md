---
id: todo-mcp-step-crud-009-1
target: working-tree-2026-07-23
compared_with: todo-mcp-step-crud-009
---

# Verdict

**PASS after resolving one P2 verification finding. No open P1, P2, or P3 finding remains.**

# Finding resolved

- **P2 — real repository evidence:** the first focused MCP and smoke tests used injected
  repositories, so they did not prove the new deterministic status setter across encrypted SQLite
  projection/version/outbox state. The final native regression now exercises Step create, title
  update, repeated complete, repeated reopen, and soft delete through `TodoistSyncRepository`.
  Effective changes produce one exact command each; repeated assignment preserves projection
  version, device sequence, and outbox bytes.

# Evidence

- Empty strings, negative integers, and integers above `Number.MAX_SAFE_INTEGER` fail before
  `createTodo`; legacy create-time `null` is removed from the follow-up update.
- Six public Step tools validate 20-digit IDs, live rows, parent Todo, customer ownership, titles,
  status, position, and timestamps. Writes reread and verify the persisted result.
- Complete and reopen call `setSubTodoStatus`, never the legacy toggle primitive, so repeating the
  same operation cannot reverse a concurrent target state.
- The stdio smoke lifecycle preserves an ownership marker, verifies every Step transition, deletes
  only its own data on failure, and never emits Step writes in read-only mode.
- The portable skill distinguishes atomic Todos from user-owned Steps, omits unspecified dates,
  performs duplicate-aware bounded retries after clear validation rejection, and treats timeout or
  disconnect as an ambiguous result that requires settling and rechecking.

# Verification

- `yarn test:mcp:todo-step-crud` — pass.
- `yarn test:mcp:todo-smoke` — pass.
- `yarn typecheck:mcp` and `yarn test:mcp:multi-instance` — pass.
- `yarn typecheck:todoist-sync` and `yarn test:todoist-sync` — pass, 38/38.
- Skill export, onboarding, version, YAML, and byte-equivalence checks — pass.
- Independent skill forward test — pass without a live MCP write.
- `git diff --check` — pass.

# Residual boundary

Todo creation intentionally remains non-idempotent because identical intentional Todos are valid.
A repository/runtime failure after a committed base create can therefore still have an ambiguous
result; the skill requires the agent to wait, list, and resolve ownership before any retry. No live
production personal Todo was written during automated verification.
