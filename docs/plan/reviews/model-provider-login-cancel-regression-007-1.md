---
id: model-provider-login-cancel-regression-007-1
target: 1c7faf6
compared_with: model-provider-login-cancel-regression-007
status: pass
---

# Verdict

**PASS after one develop/verify correction loop. No P0–P2 finding remains.**

# Findings resolved

- **P1:** The first implementation skipped old credential cleanup after a second renderer replaced
  `activeConnectAttempt`, and swallowed cleanup failure. The old mutation now cleans its connected
  credential before releasing the queue regardless of replacement, cannot commit over the new
  attempt, and fails closed as `unavailable` when cleanup cannot be verified. Background credential
  reconciliation cannot restore stale `ready`; an explicit later login remains recoverable.
- **P2:** Cancel processing briefly rendered an enabled but ignored Login button. The Cancel/loading
  branch now includes the local `cancel` action until the request settles.
- **P2:** Reconnect and Logout relied on implicit inline layout. Their business wrapper now has an
  explicit flex row and 8px gap.

# Evidence

- Credential login uses attempt-local in-memory storage. Only the current generation promotes its
  credential; the active external login is raced with cancellation so an implementation that
  ignores `AbortSignal` cannot block Cancel or overwrite a replacement.
- Provider tests cover pre-initialization cancellation, active cancellation, immediate retry,
  credential tail races, cross-renderer replacement, cleanup failure, fail-closed reconciliation,
  and retry after failed cleanup.
- Renderer action generations gate connect, cancel, reconnect, and logout results and cleanup.

# Verification

- `yarn test:model-provider` - pass, 13/13.
- Renderer i18n check - pass.
- Node typecheck - pass.
- Touched Web files - no task diagnostic among the repository's existing unrelated baseline.
- `git diff --check` - pass.

# Boundary

Ral owns live Setting, browser OAuth, Cancel, and Reconnect observation. Per request, no Electron
launch, real OAuth flow, package build, or publication was run.
