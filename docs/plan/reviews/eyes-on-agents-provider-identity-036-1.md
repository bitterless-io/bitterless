# EyesOnAgents Provider Identity Review — Round 1

Status: accepted

Date: 2026-08-17

## Findings

No open P1, P2, or P3 finding remains in the reviewed task 036 scope.

## Blocking-fix closure

- **Retained 0.0.69 database migration — closed.** The provider rebuild is registered at the new
  immutable version code `260817143129`, and `package.json` carries the same current version code.
  A provider-blind fixture whose migration ledger is already stamped `260813155645` now executes
  exactly that newer migration. The fixture retains title, unread/completion, latest-user-prompt,
  raw snapshot, Hook receipt, and completion receipt state while gaining provider-qualified
  thread, snapshot, and receipt identities.
- **Claude Desktop identity validation — closed.** DAO hydration routes every persisted
  `desktop_session_id` through the shared parser. It accepts only `null` or
  `local_<UUID>` (with UUID version/variant validation), normalizes hexadecimal case, and rejects
  a bare UUID, arbitrary string, and path-shaped value. The hydrated `session_key` is separately
  checked against the parsed provider plus thread UUID before the row is exposed.

## Contract assessment

- Existing Codex rows migrate to `codex:<uuid>` without losing Domain, archive, runtime, unread,
  prompt, Open, snapshot, or delivery/completion-receipt state.
- Valid active legacy Claude rows import idempotently as `claude:<uuid>` with archive state
  `unknown`; the legacy source table remains untouched.
- Codex-specific App Server, Hook, polling, archive, and refresh queries remain explicitly scoped
  to provider `codex`, while renderer row keys, Open/loading, drag/move, and search selection use
  provider-qualified `sessionKey`.
- Fresh schema and retained-schema migration paths converge on the same provider-aware columns and
  uniqueness constraints. The rebuild stays inside one SQLite transaction.

## Verification

- `yarn audit:sqlite-migrations` — pass, including all 12 Core baselines and
  `eyes-current-stamped-provider-blind`, which ran only migration `260817143129`.
- `yarn test:eyes-on-agents:repository` — pass.
- `yarn test:eyes-on-agents:core` — pass, including strict Desktop Session ID parser coverage.
- `git diff --check` — pass before this review file was authored.
- No Electron process or UI automation was launched.

## Conclusion

**Pass.** Task 036 may proceed to task 037. Ral's Electron UI acceptance remains intentionally
manual and is not claimed by this review.
