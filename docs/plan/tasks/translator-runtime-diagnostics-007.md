---
id: translator-runtime-diagnostics-007
scope: omni-translator runtime and diagnostics
status: done
depends-on: [translator-fast-mode-006, application-diagnostics-010]
---

# Objective

Prevent an accepted translation from remaining pending outside its 60-second deadline, remove
unrelated model-catalog work from fixed Translator runtime preparation, and persist sanitized
translation-only lifecycle evidence in a dedicated profile-isolated log directory.

# Context

- `docs/features/translator.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/translator-runtime-stall-and-missing-log.md`
- `docs/features/model-provider.md`

# Path

- `src/main/translator/`
- `src/main/codex/codexRuntime.service.ts`
- `src/main/codex/codexRuntime.runtime.ts`
- `src/main/logging/`
- `tests/coin/unit/codexRuntime.service.test.ts`
- `tests/translator/`
- `docs/features/translator.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/translator-runtime-stall-and-missing-log.md`

# Verification

- Independent source review verifies that one deadline races every translation-owned asynchronous
  stage, late settlements are observed safely, and fixed-target preparation disables model-network
  refresh without changing provider inference.
- Independent source review verifies the dedicated logger path, profile isolation, sanitization,
  rotation, request-stage coverage, and exclusion of login/source/output/credential content.
- `git diff --check`.
- Per owner instruction, do not run automated tests, Electron, packaging, or release commands. The
  owner will manually verify logged-in `hi`, deadline behavior, and produced log contents.
