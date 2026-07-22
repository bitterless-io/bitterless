---
id: todoist-sync-desktop-001-9
target: 99f8ad0f5c2c59c03ee753fdaea66c231eb76ab8
compared_with: todoist-sync-desktop-001-8
---

# Verdict

**PASS. The post-deploy parent-order P1 and its terminal-rollback follow-up are fixed.**

# Findings

No P1 or P2 finding was identified.

# Results

- Canonical baselines, outbox transitions, projections, events, and the opaque sync token commit in
  one `BEGIN IMMEDIATE` transaction; the generation fence rolls the complete response back.
- Missing-parent resources commit their canonical baseline without prematurely writing an FK child.
  A later Domain wakes Todos and a later Todo wakes SubTodos through the indexed
  `parent_resource_id` lookup.
- Projection writes run Domain -> Todo -> SubTodo. Null-canonical optimistic rollback recursively
  blocks unsent descendants and removes projections SubTodo -> Todo -> Domain; a parent with any
  remaining child row is not physically removed.
- ACK/error proof and the dynamic dependency queue preserve outbox settlement. A deferred ACKed Todo
  emits its remote move only when the parent projection arrives, and a repeated parent baseline does
  not duplicate that event.
- `yarn test:todoist-sync` passed 23/23. The two 500-row parent-late cases completed in about 0.4 and
  0.2 seconds during independent verification.
- `yarn typecheck:todoist-sync`, SQLite release tests, `yarn audit:sqlite-migrations`,
  `yarn typecheck:todo-web`, `yarn typecheck:mcp`, `yarn check:todo-window-runtime`,
  `yarn test:mcp:todo-smoke`, and `git diff --check` passed independently.
- The task owner also passed `yarn build` after the final runtime change.

# Release Scope

This fix is confined to the desktop SQLCipher projection layer and its unreleased schema-v1
baseline. It does not modify the backend runtime, PostgreSQL schema, Function Compute environment,
or deployed archive. No FC or PostgreSQL access was needed for this review; the already verified
Shanghai deployment and clean production Todo database remain unchanged.

# Residual Risk

The three-level recursive failure path, canonical-proof dynamic blocking, and a deferred SubTodo
baseline across restart do not each have a separate named test. Their shared code paths were reviewed
and the complete focused suite found no defect.
