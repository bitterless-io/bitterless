# Todo opens without an active sync session and treats XPC failures as data

状态：已修复

Implementation: [todo-sync-runtime-recovery-002](../plan/tasks/todo-sync-runtime-recovery-002.md)

## Report

Opening Todo in the DEBUG application produces three related symptoms:

1. the board fails at `todo.store.ts` while calling `.filter()` on `null`;
2. Archived domains reports that it cannot load;
3. creating a Domain incorrectly reports the 17-active-Domain limit.

## Confirmed cause

The post-deploy parent-order fix added `parent_resource_id` and its lookup index to
`todo_sync_baselines`, but changed the already-observable schema-v1 definition in place. A DEBUG
customer database created by the earlier v1 runtime therefore has a valid v1 ledger with the older
table shape. Reopening it with the current runtime fails the schema assertion before the customer
repository becomes active.

Authentication intentionally starts optional runtimes in the background. The Todo window is not
gated on that activation, so it can also load during the smaller interval before activation has
reached Main.

`electron-xpc` catches Main handler failures and resolves renderer requests with `null`. The Todo
renderer currently assumes required list results are arrays and treats the falsey Domain-create
result as the explicit capacity outcome. Consequently the original migration/session failure is
hidden by misleading renderer errors.

## Required correction

1. Treat the locally observable original v1 shape as immutable. Add an ordered v2 migration that
   adds the nullable baseline parent reference and lookup index without replacing or deleting any
   existing Todo, outbox, baseline, event, or sync-state row.
2. Make v2 idempotently accept both older-v1 databases and development databases whose v1 table
   already contains the new column/index but whose ledger still ends at v1.
3. Keep optional runtime activation non-blocking for login, but retain its completion state in the
   authenticated Home renderer. Opening embedded or standalone Todo must await/retry the current
   customer's Todo activation before creating its renderer.
4. Validate required Todo XPC results at the renderer boundary. `null` is a runtime/transport
   failure, never an empty collection or Domain-limit result. Only the repository's explicit
   capacity outcome may show the 17-Domain warning.
5. Observe background refresh failures so they do not become unhandled promise rejections.

## Acceptance

- A fixed-password encrypted database created with the pre-parent-reference v1 schema reopens,
  records v2, preserves sentinel state/baseline rows, and passes integrity/foreign-key checks.
- A v1-ledger development database that already has the v2 column/index also upgrades without data
  loss or duplicate-column failure; repeated current-schema reopen is idempotent.
- Login remains complete without waiting for Todo, while both Home Todo entry points wait for the
  current customer activation and retry a prior activation failure.
- Failed required XPC list calls produce an explicit Todo-unavailable failure rather than `.filter`
  on `null`; Domain creation never maps `null` to the 17-Domain message.
- Focused migration/native/auth/Todo-web/runtime checks and the Electron production build pass.

## Resolution — 2026-07-22

- Added a non-destructive ordered v2 migration for the parent baseline column/index. Both the real
  historic encrypted v1 database and the already-shaped DEBUG v1-ledger form upgrade safely.
- Todo entry now waits for the authenticated customer's activation result; logout, account switch,
  concurrent activation, and explicit retry are generation-fenced.
- Renderer reads and mutations reject transport `null` explicitly. Only `undefined` can represent
  the Domain capacity outcome, so repository/session failures no longer show the 17-Domain warning.
- Every detached Todo UI mutation observes its failure; a live `unhandledRejection` regression proves
  a null XPC result does not escape.
- Independent re-review found no remaining P1/P2. Automated migration, native sync, auth, Todo-web,
  i18n, runtime-source, and production-build gates pass. Electron GUI acceptance remains with Ral.
