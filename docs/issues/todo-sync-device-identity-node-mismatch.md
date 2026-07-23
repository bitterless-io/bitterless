# Todo sync device identity changes across login methods

Status: Fixed

## Symptom

Todo synchronization reports:

```text
[todoist sync] server changed this device Snowflake node
```

## Cause

The local Todo database is customer-scoped and retains its assigned Snowflake node. The previous
authentication flow used `bootstrap-<seed>` for email-code login but derived
`<customer-id><seed>` for password login. Switching methods therefore authenticated the same
installation as a new Core device. Core correctly allocated a second node; desktop then rejected
the response to protect IDs generated with the cached node.

Core does not reassign a live device in this path.

## Fix contract

- Create one installation `device_id` only when it is absent and persist it immediately.
- Reuse the stored value for password login, email-code login, token restore, and Todo activation.
- Remove login-method/customer-derived replacement identities and the two-login password bridge.
- Keep the cached-node mismatch fail-closed; never repair it by silently accepting a different
  server node.
- Existing pre-release DEBUG databases already paired with two identities require guarded recovery.
  A clean database may rebind and bootstrap automatically; any database with unsynchronized IDs or
  commands must remain fail-closed. See
  [`todo-sync-stale-local-device-binding`](todo-sync-stale-local-device-binding.md).

## Resolution — 2026-07-22

The renderer now creates one installation ID only when `DEVICE_ID_KEY` is absent and captures it
for the lifetime of the application session. Password login, email-code login, restored sessions,
and Todo activation all reuse that value. The cached Snowflake-node mismatch remains fail-closed.

The 2026-07-23 follow-up adds clean-only recovery for databases created before this identity fix;
dirty legacy databases still retain the fail-closed contract.

Independent verification passed the authentication contract suite, the real encrypted-repository
node-conflict regression, Todo sync tests, renderer checks, and the production build. See
[`todo-sync-refresh-identity-004-1`](../plan/reviews/todo-sync-refresh-identity-004-1.md).
