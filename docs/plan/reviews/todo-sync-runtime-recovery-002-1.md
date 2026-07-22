---
id: todo-sync-runtime-recovery-002-1
target: worktree-2026-07-22
compared_with: todo-sync-runtime-recovery-002
---

# Verdict

**PASS. No P1 or P2 finding remains.**

# Findings

The first review found one P2: strict null-result guards correctly rejected failed Todo mutations,
but several UI call sites detached those Promises and could produce an unhandled rejection. The
implementation added one observation boundary across all Todo UI mutation paths and a live
`unhandledRejection` regression. Independent re-review confirmed that finding is closed.

# Results

- The immutable historic v1 migration upgrades to the ordered v2 ledger without deleting or
  replacing existing encrypted Todo data. Both observed physical column orders, invalid ledgers,
  incomplete state, injected rollback, reopen, integrity, and foreign-key cases are covered.
- Authenticated Todo activation is deduplicated and generation-fenced. Embedded and standalone
  entry wait for the matching customer/device/session result and can retry an earlier failure.
- Required Todo collections, records, count maps, optional rows, and void DAO results reject
  transport `null`. `undefined` alone remains the Domain capacity outcome.
- `observeTodoMutation` consumes every affected Todo UI fire-and-forget path, including selection,
  copy, drag/drop, throttle, Menu, clock, and Modal/Enter deletion. Domain/SubTodo void writes and
  all four sort-order writes fail before any local optimistic change when XPC returns `null`.
- `yarn typecheck:todo-web`, `yarn typecheck:todoist-sync`, and `git diff --check` passed.
- `yarn test:todoist-sync` passed 26/26, including the encrypted pre-v2 reopen and live
  unhandled-rejection regression. The task owner also passed the auth, SQLite audit/test,
  renderer-i18n, Todo-window runtime, and full Electron production-build gates.

# Boundary

No Electron GUI was launched. Todoist-sync/window-control void calls observe Promise rejection but
do not all add a separate resolved-null guard; independent review classified that as optional
cross-cutting XPC hardening rather than a blocker for this data/session recovery task.
