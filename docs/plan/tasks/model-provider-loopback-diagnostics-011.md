---
id: model-provider-loopback-diagnostics-011
scope: shared-model-provider
status: in-progress
depends-on: [model-provider-fresh-login-callback-009, application-diagnostics-010]
---

# Objective

Make Codex browser login prove that Pi's loopback callback listener belongs to the current Main
process before opening the authorization page, and persist enough sanitized lifecycle evidence to
distinguish callback, exchange, credential, promotion, and verification failures.

# Context

- `docs/issues/codex-model-login-browser-success-stuck.md`
- `docs/issues/application-file-logging-missing.md`
- `docs/features/model-provider.md`
- `docs/features/application-diagnostics.md`
- Node HTTP diagnostics channels:
  `https://nodejs.org/download/release/v22.18.0/docs/api/diagnostics_channel.html#http`

# Path

- `src/main/codex/codexCredential.service.ts`
- `src/main/codex/codexLoopbackObserver.service.ts`
- `src/main/logging/`
- `docs/features/model-provider.md`
- `docs/issues/codex-model-login-browser-success-stuck.md`

# Verification

Owner performs runtime testing.

- Source review verifies that browser open is gated on current-process callback ownership.
- Source review verifies missing, foreign, and unexpected listeners fail closed.
- Source review verifies callback request/response diagnostics contain no query values or secrets.
- Source review verifies all observer subscriptions and probe requests are cleaned up on success,
  failure, cancellation, timeout, and replacement.
- No automated or runtime tests are executed by the delivery agent per owner request.
