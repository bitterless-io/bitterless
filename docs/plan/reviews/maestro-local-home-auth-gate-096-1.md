# maestro-local-home-auth-gate-096 — Review 1

- Date: 2026-09-01
- Scope: independent review of the final fixed-Home authentication gate, hidden-Home authority,
  shared Login surface, session recovery, snapshot ordering, error boundary, and focused regression
  coverage against `docs/plan/tasks/maestro-local-home-auth-gate-096.md`.
- Method: two read-only source-review passes plus focused Node tests, scoped lint/type checks, and
  diff checks. No Electron, Playwright/E2E, packaged-app smoke, signing, notarization, publication,
  or network operation was used.

## Findings

The first pass found four P1 and three P2 issues:

1. A stale initial read or command result could overwrite a newer logout/invalidation snapshot.
2. A malformed broadcast left the last authenticated snapshot visible.
3. A live but unresponsive handler could leave the initial gate loading for about 132 seconds.
4. Fixed Home and shared Login could race or misreport duplicate post-login navigation.
5. One consumer abort could cancel the shared saved-session recovery for every consumer.
6. Token-only invalidation with an already-null customer might not emit signed-out presentation.
7. Arbitrary backend error text could cross the bridge after truncation.

All seven findings were fixed before approval. The second pass found no new or unresolved P0-P2
issue.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Hidden Home remains the sole authority | `homeShellBridge.handler.ts` delegates every auth operation to the hidden `authStore`; fixed Home imports only the typed bridge and its XPC-only preload remains unchanged | pass |
| Strict token-free contract | `homeShellBridge.contract.ts` requires exact snapshot/result keys and rejects tokens, extra customer data, arbitrary error text, invalid epochs, and invalid revisions | pass |
| Stale state cannot restore authenticated content | Hidden Home allocates a persisted authority epoch and increasing revision; `localHomeAuth.store.ts` accepts only a newer `(authorityEpoch, revision)` pair | pass |
| Malformed or unavailable authority fails closed | Subscription parsing reports invalid payloads explicitly, clears the trusted snapshot, and starts six 500ms probes with five 250ms gaps, bounded to 4,250ms | pass |
| Only an active session mounts the workspace | `LocalHomeApp.vue` renders the neutral authority gate first, then the shared Login, and mounts the rail/router only for the `ready` phase | pass |
| One complete Login surface is reused | `LegacyLogin.vue` adapts `authStore`; fixed Home passes its bridge controller to the same `Login.vue`, retaining password, OTP, reset, first-password, recovery, retry, cancel, and switch-account flows | pass |
| Post-auth navigation has one owner | The legacy adapter retains Login-owned navigation; the fixed adapter disables it and `LocalHomeApp.vue` alone transitions the auth gate to Mini Apps while preserving stable Settings navigation | pass |
| Recovery cancellation is isolated | `authSessionRecovery.service.ts` uses one underlying recovery and per-consumer waiting; only explicit user cancellation aborts the shared controller | pass |
| Logout and token-only invalidation propagate | Token set/clear increments a reactive presentation revision watched synchronously by the hidden bridge, including when `current` is already null | pass |
| Visible errors are sanitized | The handler maps known status/error classes to fixed safe messages and the result parser accepts only that allowlist | pass |

## Verification

- Focused Maestro/auth-gate tests: passed, 14/14.
- Combined focused/customer-auth evidence: passed, 33/34. The sole failure is the existing
  `env.rig.json5` production-endpoint count mismatch (`3 !== 2`), outside this task.
- `yarn typecheck:node`: passed.
- `yarn typecheck:web`: blocked only by existing unrelated Poker/Chat/global bridge/path errors; no
  auth-gate file appeared in the diagnostics.
- Task-scoped ESLint: passed with zero errors; the shared translation files retain existing
  Prettier warnings outside the task-owned additions.
- Debug `yarn build`: passed.
- `git diff --check`: passed.

## Conclusion

**Approved — no unresolved P0-P2 findings.**

The source implementation now restores the existing Login experience inside Maestro fixed Home and
keeps Mini Apps fail-closed behind the hidden Home authentication authority. Ral's Electron/runtime
visual and E2E acceptance remains intentionally pending.
