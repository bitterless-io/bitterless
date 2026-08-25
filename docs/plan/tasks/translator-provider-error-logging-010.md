---
id: translator-provider-error-logging-010
scope: omni-translator provider diagnostics
status: done
depends-on: [translator-runtime-diagnostics-007]
---

# Objective

Make packaged Translator provider failures diagnosable from the dedicated production log by
preserving a bounded, privacy-safe diagnostic summary across the shared Codex runtime boundary and
by keeping fixed lifecycle stage evidence readable through the application sanitizer. Do not
change the renderer/public translation error contract.

# Context

- `docs/features/translator.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/translator-provider-error-log-detail-missing.md`
- `docs/features/model-provider.md`

# Path

- `src/main/codex/codexRuntime.service.ts`
- `src/main/translator/translator.service.ts`
- `src/main/logging/translatorLog.service.ts`
- `tests/coin/unit/codexRuntime.service.test.ts`
- `tests/translator/`
- `docs/features/translator.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/translator-provider-error-log-detail-missing.md`
- `docs/plan/tasks/translator-provider-error-logging-010.md`

# Implementation Constraints

1. Pi structured assistant diagnostics and typed/directly observed terminal evidence are converted
   immediately into separate allowlisted summaries. A summary may contain only category,
   configured/fallback transport, provider phase, bounded HTTP status, bounded typed error
   name/code, and a fixed canonical detail. Free-form provider/error text cannot drive persisted
   fields.
2. Request bytes, source/output content, request/response bodies, headers, client/request/provider
   IDs, tokens, OAuth material, credentials, and raw objects never enter the Translator logger.
3. Detail is selected from a fixed canonical allowlist and is sanitized again by the application
   log boundary.
4. Fixed stage identifiers are rendered as short allowlisted stage and phase fields. A terminal
   record includes the last non-terminal stage/phase without concatenating a long opaque token.
5. `CodexRuntimeAuthRequiredError` keeps the existing provider invalidation behavior. The detailed
   runtime summary is log-only and does not cross the Translator XPC contract.
6. No retry, transport preference, timeout, provider/model target, renderer copy, or login behavior
   changes in this task.

# Verification

- Independent source review verifies provider-error capture, privacy boundaries, readable stage
  fields, and unchanged public/auth behavior.
- `git diff --check`.
- Per owner instruction, do not run automated tests, typecheck, Electron, packaging, or release
  commands. The owner will package and verify production translation/log output.

# Outcome

- Pi WebSocket transport/fallback evidence and the terminal provider failure are preserved as
  independent log-only diagnostics, with no field mixing between the two sources.
- Terminal status is read only from the runtime response callback; typed structural error fields
  remain allowlisted. Free-form provider text is never persisted or used to derive log fields.
- Translator lifecycle stage/phase and terminal last-stage evidence remain readable through the
  opaque-token sanitizer.
- Independent source review passed in
  `docs/plan/reviews/translator-provider-error-logging-010-3.md`; automated verification and
  packaging remain assigned to the owner.
