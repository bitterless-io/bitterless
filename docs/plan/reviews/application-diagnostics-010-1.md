---
id: application-diagnostics-010-1
target: 5818a49f33dfc92c7f86d8b61f6abf0a7375baa2
compared_with: application-diagnostics-010
status: blocked
---

# Verdict

**BLOCKED. Two blocking P2 findings prevent delivery.**

# Findings

## P2 blocking — Modern Codex callback and token-exchange stages are not observable

Design contract:

- `docs/features/application-diagnostics.md` requires sanitized Codex lifecycle evidence sufficient
  to diagnose the current post-callback failure.
- `docs/issues/application-file-logging-missing.md` requires a failed login to leave a
  stage-specific error that distinguishes callback, token verification/exchange, credential
  promotion, and status verification.

Implementation evidence:

- `src/main/codex/codexCredential.service.ts:489-511` emits `callback-observed` only when a Pi
  `progress` or `info` message matches `reportsCallbackProgress()`.
- The pinned Pi 0.80.10 browser OAuth implementation emits only `auth_url` before waiting for its
  internal callback (`node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js:353-381`).
  It receives the callback and exchanges the authorization code at lines 381-406 without emitting
  `progress` or `info`.
- Consequently, the modern path cannot emit `callback-observed`. If the callback succeeds but token
  exchange fails, `src/main/codex/codexCredential.service.ts:563-572` records only the generic
  `attempt-failed` stage. `login-promise-resolved` is emitted only after callback handling, token
  exchange, and the Pi attempt-store write have all succeeded.
- `scripts/diagnostics/applicationDiagnostics.test.ts:186-210` only asserts that stage-name strings
  exist in source; it does not execute the real Pi notification sequence and therefore gives false
  coverage for the unreachable modern callback stage.

Impact: the exact browser-success failure this task exists to diagnose still cannot be localized to
callback receipt versus token exchange. The accepted stage-specific diagnostics contract is not
met.

## P2 blocking — Raw global console and error capture can persist secrets and URL queries

Design contract:

- `docs/features/application-diagnostics.md` and the final acceptance item in
  `docs/issues/application-file-logging-missing.md` require that tokens, credential values,
  authorization queries, and raw proxy values never enter diagnostic logs.

Implementation evidence:

- `src/main/logging/log.setup.ts:42-54` forwards the first-party Renderer console message directly
  to `log.processMessage()` with no redaction.
- `src/main/logging/log.setup.ts:67-69` replaces Main `console.*` with raw electron-log functions
  and enables uncaught exception/unhandled rejection capture, again without a sanitizing transform
  or error callback.
- Existing Main code already logs arbitrary URLs verbatim; for example
  `src/main/xpc/omniWindow.handler.ts:34-36` writes `params.url`, including any query or fragment,
  directly through `console.log`.
- The sanitizers in `src/shared/diagnostics/diagnostic.service.ts` are used by selected Codex and
  snapshot code only. They are not applied at the file transport boundary, so unrelated existing
  console/error data bypasses them.
- `scripts/diagnostics/applicationDiagnostics.test.ts:133-163` tests the sanitizer in isolation but
  does not send a secret-bearing Main/Renderer message through the configured electron-log file
  pipeline.

Impact: enabling persistent global capture can write precisely the secret/query material prohibited
by the accepted contract into `main.log`.

# Verified contract areas

- The four profile names and debug/release log path policy match the accepted table.
- The runtime profile bootstrap is the first application import, and the inspected Main bundle
  places `applyRuntimeProfile()` before application-owned `userData` reads.
- Diagnostics XPC accepts only allowlisted directory keys; environment entries expose presence or
  safe origins rather than raw secret values.
- Settings places Log immediately above About and uses the expected Arco controls and BEM classes.

# Verification

- `yarn test:application-diagnostics` — pass, 8/8 tests, but the two source/isolated-helper gaps
  described above remain.
- `yarn test:model-provider` — pass, 16/16 tests.
- `yarn typecheck:node` — pass.
- `yarn check:renderer-i18n` — pass.
- Focused Settings lint:
  `yarn eslint src/renderer/home/src/views/setting/Setting.vue src/renderer/home/src/views/setting/components/LogSetting/LogSetting.vue src/renderer/home/src/views/setting/components/LogSetting/logSetting.store.ts`
  — pass.
- `git diff --check fa224e0..5818a49` — pass.
- No package or publish command was run.

