---
id: model-provider-fresh-login-callback-009
scope: shared-model-provider
status: in-progress
depends-on: [model-provider-login-cancel-regression-007, codex-gpt55-retention-008]
---

# Objective

Make every explicit Codex Login a fresh, callback-owner-safe attempt so a browser success completes
inside Bitterless without cached credential influence, while preserving cancellation and
replacement-login fencing.

# Context

- `docs/issues/codex-model-login-browser-success-stuck.md`
- `docs/issues/codex-model-login-cancel-regression.md`
- `docs/features/model-provider.md`

# Path

- `src/main/codex/codexCredential.service.ts`
- `src/main/codex/codexCredential.store.ts`
- `tests/coin/unit/codexCredential.service.test.ts`
- `docs/features/model-provider.md`
- `docs/issues/codex-model-login-browser-success-stuck.md`

# Implementation

- Detect the modern `ModelRuntime` before creating any browser callback capture. Let the runtime own
  `localhost:1455`; retain the companion capture only for the legacy storage login path.
- Replace the removed Pi `AuthStorage` export with app-owned in-memory and locked-file
  `CredentialStore` implementations that remain compatible with Pi's `auth.json`.
- Create all credential/status runtime instances with model-network refresh disabled.
- Delete the previous persistent Codex credential before starting the isolated login, then promote
  only the current generation's new in-memory credential.
- Keep the active-attempt abort signal attached to the modern manual-code prompt so Cancel also
  releases Pi's internal callback server.
- Keep the shared Model Provider status probe aligned with its fixed GPT-5.5 target.

# Verification

- Run the focused credential service tests.
- Run `yarn test:model-provider`.
- Run `yarn typecheck:node`.
- Run `git diff --check`.
