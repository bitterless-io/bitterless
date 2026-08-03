---
id: codex-production-login-recovery-012
scope: production Codex browser login
status: in-progress
depends-on: [model-provider-fresh-login-callback-009]
---

# Objective

Restore the accepted dual-stack Codex browser-login flow on the latest production release line and
ship a newer signed macOS ARM production release.

# Context

- `docs/features/model-provider.md`
- `docs/issues/codex-model-login-browser-success-stuck.md`
- production `0.0.64` / `260802151913` evidence in
  `~/Library/Logs/Bitterless/main.log`

# Path

- `src/main/codex/codexCredential.service.ts`
- `src/main/codex/codexCallbackCapture.ts`
- `src/main/codex/codexLoopbackObserver.service.ts`
- `tests/coin/unit/codexCredential.service.test.ts`
- `docs/features/model-provider.md`
- `docs/issues/codex-model-login-browser-success-stuck.md`
- `package.json`
- `build/release_note.md`

# Verification

- `yarn test:model-provider`
- `yarn typecheck:node`
- `git diff --check`
- Independent source review verifies current-process IPv4 ownership, macOS IPv6 forwarding into
  the same Pi login, late-capture cleanup, and credential-generation fencing.
- Release uses the latest `origin/release/2608` production source as its base, passes existing
  release preflight gates, produces a version newer than `260802151913`, and completes signed
  macOS ARM publication.
