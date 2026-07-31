---
id: model-provider-loopback-diagnostics-011
scope: shared-model-provider
status: implemented-owner-verification-pending
depends-on: [model-provider-fresh-login-callback-009, application-diagnostics-010]
---

# Objective

Make Codex browser login prove current-process IPv4/IPv6 loopback coverage before opening the
authorization page, route a macOS IPv6 redirect into the same Pi login attempt, and persist enough
sanitized lifecycle evidence to distinguish callback, exchange, credential, promotion, and
verification failures.

# Context

- `docs/issues/codex-model-login-browser-success-stuck.md`
- `docs/issues/application-file-logging-missing.md`
- `docs/features/model-provider.md`
- `docs/features/application-diagnostics.md`
- Node HTTP diagnostics channels:
  `https://nodejs.org/download/release/v22.18.0/docs/api/diagnostics_channel.html#http`

# Path

- `src/main/codex/codexCredential.service.ts`
- `src/main/codex/codexCallbackCapture.ts`
- `src/main/codex/codexLoopbackObserver.service.ts`
- `tests/coin/unit/codexCredential.service.test.ts`
- `src/main/logging/`
- `docs/features/model-provider.md`
- `docs/issues/codex-model-login-browser-success-stuck.md`

# Verification

Owner performs runtime testing.

- Source review verifies that browser open is gated on Pi IPv4 ownership plus a listening macOS
  IPv6 companion.
- Source review verifies that either address family completes the same Pi login and cannot promote
  a cancelled or replaced attempt.
- Source review verifies missing, foreign, and unexpected listeners fail closed.
- Source review verifies callback request/response diagnostics contain no query values or secrets.
- Source review verifies all observer subscriptions and probe requests are cleaned up on success,
  failure, cancellation, timeout, and replacement.
- No automated or runtime tests are executed by the delivery agent per owner request.

# Reviews

- [Initial blocked review](../reviews/model-provider-loopback-diagnostics-011-1.md)
- [Final passing review](../reviews/model-provider-loopback-diagnostics-011-2.md)

# Handoff

Implementation and independent static source review are complete. Owner runtime verification
remains for both macOS loopback address families, the Translator login state refresh, and the
persisted `[codex-login]` lifecycle evidence.
