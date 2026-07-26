---
id: translator-error-diagnostics-004
scope: omni-translator
status: done
depends-on: [translator-inline-retry-003]
---

# Objective

Surface a sanitized cause for every Translator failure and give every failure a route to Codex
re-login, including an unclassified expired session that keeps `authState` at `ready`.

# Context

- `docs/issues/translator-error-diagnostics-and-relogin.md`
- `docs/features/translator.md`
- `docs/features/model-provider.md`
- `docs/features/renderer-i18n.md`

# Path

- `src/shared/diagnostics/diagnostic.service.ts`
- `src/shared/setting/settingNavigation.contract.ts`
- `src/shared/translator/translator.contract.ts`
- `src/shared/modelProvider/modelProvider.contract.ts`
- `src/shared/modelProvider/modelProvider.schema.ts`
- `src/main/codex/codexCallbackCapture.ts`
- `src/main/codex/codexCredential.service.ts`
- `src/main/codex/codexRuntime.service.ts`
- `src/main/modelProvider/modelProvider.service.ts`
- `src/main/translator/translator.service.ts`
- `src/main/xpc/mainWindow.handler.ts`
- `src/main/xpc/modelProvider.handler.ts`
- `src/renderer/translator/src/App.vue`
- `src/renderer/translator/src/App.less`
- `src/renderer/translator/src/store/translator.store.ts`
- `src/renderer/translator/src/emitter/translator.emitter.ts`
- `src/renderer/home/src/main.ts`
- `src/renderer/home/src/xpc/setting.subscriber.ts`
- `src/renderer/home/src/views/setting/Setting.vue`
- `src/renderer/home/src/views/setting/store/settingNav.store.ts`
- `src/renderer/home/src/views/setting/components/LLMSetting/LLMSetting.vue`
- `src/renderer/home/src/views/setting/components/LLMSetting/llmSetting.store.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `tests/translator/`
- `tests/modelProvider/`
- `tests/coin/unit/codexCredential.service.test.ts`

# Verification

- Unit-test `sanitizeDiagnostic()` against key, bearer, JWT, long-token, email, and home-path input,
  including case-insensitive Windows paths, plus whitespace collapse, redact-before-truncate
  ordering, and the bound.
- Test detail propagation through the runtime and service contracts, the renderer detail guard, the
  invalidated-snapshot response ordering, error-strip action visibility rules, and removal of the
  `generic` fallback. Invalid-output diagnostics must not contain model output.
- Test a real login cancellation through credential, provider, XPC, and Model-tab state, followed by
  an immediate successful retry. Preserve a pending Model-tab destination through customer login.
- Run Translator tests, the retry test, and the renderer i18n check.
- Run touched Node type checks, audit Web type-check output for touched-file diagnostics, run the
  full build and `git diff --check`.

# Review

- [translator-error-diagnostics-004-1](../reviews/translator-error-diagnostics-004-1.md) - pass
