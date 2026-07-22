---
id: todo-sync-refresh-identity-004
scope: one Todo Refresh/status control and one persistent installation device identity
status: done
depends-on: [todo-sync-runtime-recovery-002]
---

# Todo sync Refresh control and device identity

## Objective

Remove the duplicate Todo sync toolbar button. Keep one Refresh control that requests sync, rotates
while sync is active, and exposes the last successful time, current result, and failure reason on
hover. Fix the device-node error at its source by making every authentication method reuse one
create-once installation `device_id`.

## Context

- `docs/features/todoist-sync.md`
- `docs/issues/todo-sync-device-identity-node-mismatch.md`
- `docs/design/customer-authentication.md`
- `docs/plan/analysis/todoist-sync.md`

## Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Todo                         [Archive] [MCP] [Refresh] [Menu] │
└──────────────────────────────────────────────────────────────┘
                                             │ hover
                                             ▼
                               ┌──────────────────────────────┐
                               │ Current sync result          │
                               │ Last successful sync time    │
                               │ Error / failed commands      │
                               └──────────────────────────────┘
```

## Implementation contract

- `DEVICE_ID_KEY` is authoritative. A missing value is generated and persisted once; an existing
  value is reused without customer/login-method derivation.
- Password login, email-code login, restore, and Todo activation use the same device ID. Cached
  Snowflake nodes still reject a genuinely different server node.
- Menubar renders exactly one Refresh control. It uses Arco, Tabler, BEM/Less, and localized text.
- Refresh click requests sync and refreshes the current local projection. The icon rotates whenever
  coordinator status is `syncing`.
- Hover content truthfully labels `last_success_at` as the last successful sync, shows never-sync,
  transient error, pull-only, and permanent-failure states, and retains retry/discard actions.
- No Core endpoint, PostgreSQL schema, or wire-contract change is introduced.

## Path

- `docs/INDEX.md`
- `docs/design/customer-authentication.md`
- `docs/features/todoist-sync.md`
- `docs/issues/customer-auth-login-session-transition.md`
- `docs/issues/todo-sync-device-identity-node-mismatch.md`
- `docs/plan/README.md`
- `docs/plan/tasks/customer-auth-login-account-001.md`
- `docs/plan/tasks/todo-sync-refresh-identity-004.md`
- `scripts/auth/customer-authentication.test.mjs`
- `scripts/todoist-sync/native.test.ts`
- `src/renderer/home/src/stores/auth/auth.store.ts`
- `src/renderer/todo/src/components/MenuBar/MenuBar.vue`
- `src/renderer/todo/src/components/MenuBar/MenuBar.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`

## Verification

- `yarn test:customer-auth`
- `yarn typecheck:todoist-sync`
- `yarn test:todoist-sync`
- `yarn typecheck:todo-web`
- `yarn check:renderer-i18n`
- `yarn check:todo-window-runtime`
- `yarn build`
- `git diff --check`

## Completion — 2026-07-22

- `DEVICE_ID_KEY` now has one create-only write site. Password login, email-code login, restore,
  and Todo activation reuse the captured installation identity; customer/bootstrap derivation and
  the password two-login bridge were removed.
- A real SQLCipher repository regression proves that a conflicting server Snowflake node leaves
  cached sync state unchanged and that the original node remains usable.
- Todo now exposes one Refresh control. It requests sync, refreshes the local projection, rotates
  while the coordinator is syncing, and shows the current result, last successful time, failure
  reason, and permanent-command recovery actions on hover.
- Independent verification found no P1, P2, or P3 finding. `yarn test:customer-auth` passed 12/12,
  `yarn test:todoist-sync` passed 29/29, both focused type checks passed, renderer i18n and Todo
  runtime checks passed, `yarn build` passed, and `git diff --check` passed. See
  [`todo-sync-refresh-identity-004-1`](../reviews/todo-sync-refresh-identity-004-1.md).
