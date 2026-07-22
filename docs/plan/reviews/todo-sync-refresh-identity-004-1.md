---
id: todo-sync-refresh-identity-004-1
target: working-tree-2026-07-22
compared_with: todo-sync-refresh-identity-004
---

# Verdict

**PASS. No P1, P2, or P3 finding was identified.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Evidence

- `src/renderer/home/src/stores/auth/auth.store.ts:42` reads `DEVICE_ID_KEY`, returns every
  existing value unchanged, and generates plus persists a random 32-character ID only when the key
  is absent. The store captures that value once at line 82 and exposes the captured value at line
  95; logout and session clearing do not remove or rewrite it.
- Password login and email-code login send that same captured value at
  `src/renderer/home/src/stores/auth/auth.store.ts:159` and
  `src/renderer/home/src/stores/auth/auth.store.ts:213`. Both normal/background activation and the
  explicit Todo readiness retry use it at lines 103-136, while session restore reaches the same
  activation path at lines 268-273. The former customer-derived/bootstrap identities and the
  password two-login bridge are absent. The regression at
  `scripts/auth/customer-authentication.test.mjs:53` locks the single write site and all four reuse
  paths.
- `src/main/todoistSync/todoistSync.repository.ts:865` validates the response node through
  `TodoistSyncSnowflakeService` before opening the response transaction. The existing fail-closed
  check at `src/main/todoistSync/todoistSyncSnowflake.service.ts:21` throws before mutating the
  cached generator when a non-null cached node differs. The real encrypted-repository regression at
  `scripts/todoist-sync/native.test.ts:1214` proves the rejection leaves the persisted sync state
  field-for-field unchanged; because rejection occurs before the transaction opens, no response
  row/token/outbox update can run. The test then proves a response with the original node still
  commits normally.
- `src/renderer/todo/src/components/MenuBar/MenuBar.vue:26` owns the single Refresh icon/control and
  the Arco hover popover. The icon follows `status.syncing`; the click requests a coordinator cycle
  and reloads the current projection at line 194. The popover distinguishes syncing, pull-only,
  transient failure, success/ready, and never-synchronized states; it labels and formats the
  persisted `last_success_at`, maps the Snowflake mismatch to an authenticated-device identity
  explanation, lists permanent command failures, and retains Retry/Discard actions.
- The new status classes in `src/renderer/todo/src/components/MenuBar/MenuBar.less:62` are flat,
  shallow BEM in the sibling Less file; the active icon uses a semantic modifier and the spin
  keyframe. User-facing status labels exist in both
  `src/renderer/common/i18n/en.ts:1023` and `src/renderer/common/i18n/zh.ts:1024`. No Core endpoint,
  PostgreSQL schema, or Todo wire contract changed for this task.

# Verification

- `yarn test:customer-auth` — PASS, 12/12 tests.
- `yarn typecheck:todoist-sync` — PASS.
- `yarn test:todoist-sync` — PASS, 29/29 tests, including the one-Refresh UI contract and the real
  SQLCipher conflicting-node rollback regression.
- `yarn typecheck:todo-web` — PASS, including Todo Main/preload declaration boundary checks and
  strict Vue checking.
- `yarn check:renderer-i18n` — PASS.
- `yarn check:todo-window-runtime` — PASS.
- `yarn build` — PASS. Vite reported the pre-existing Home router mixed static/dynamic import
  warning; it was non-fatal and outside this task.
- `git diff --check` — PASS on the latest shared working tree after concurrent unrelated
  Omni/Todo-host edits.

# Residual Risk

The authentication identity regression is source-contract based rather than a live Core login
against both password and email-code endpoints. The reviewed call chain is direct, the old second
login/derived-ID paths are removed, and the native encrypted-database node-conflict behavior is
exercised with production repository code.
