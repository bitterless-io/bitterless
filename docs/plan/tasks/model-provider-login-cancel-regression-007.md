---
id: model-provider-login-cancel-regression-007
scope: shared-model-provider
status: implemented-owner-verification-pending
depends-on: [translator-error-diagnostics-004]
---

# Objective

Restore the accepted cancellable Codex login lifecycle in Setting so an abandoned OAuth attempt can
be cancelled and replaced without restarting Bitterless, while every late superseded result is
ignored.

# Context

- `docs/issues/codex-model-login-cancel-regression.md`
- `docs/issues/translator-error-diagnostics-and-relogin.md`
- `docs/features/model-provider.md`

# Path

- `src/main/codex/codexCredential.service.ts`
- `src/main/modelProvider/modelProvider.service.ts`
- `src/main/xpc/modelProvider.handler.ts`
- `src/shared/modelProvider/modelProvider.contract.ts`
- `src/renderer/home/src/views/setting/components/LLMSetting/LLMSetting.vue`
- `src/renderer/home/src/views/setting/components/LLMSetting/LLMSetting.less`
- `src/renderer/home/src/views/setting/components/LLMSetting/llmSetting.store.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `tests/coin/unit/codexCredential.service.test.ts`
- `tests/modelProvider/modelProviderCancelConnect.test.ts`

# Implementation

- Give the credential login service an explicit cancellation entry point and active-attempt guard.
  Abort the current Pi interaction and callback capture, then prevent its delayed completion from
  publishing success or replacing a newer attempt.
- Let provider cancellation bypass the blocked mutation tail, invalidate the current connect
  generation, settle the active mutation, and persist the pre-login non-ready state. If a credential
  appears in the completion race, disconnect it before publishing the cancelled snapshot.
- Clean the cancelled attempt before the queued replacement enters its credential phase, without
  letting the cancelled attempt overwrite replacement state. Cleanup failure remains a non-ready,
  observable error and is not repaired to stale `ready` by background reconciliation.
- Add `cancelConnect()` to the shared XPC contract and Main handler.
- In the Setting store, increment an action generation on login, cancel, and reconnect boundaries.
  Apply result, error, and `finally` cleanup only when the captured generation is still current.
- Replace the disabled authenticating Login control with a compact localized Cancel action. Return
  to the ordinary Login control after cancellation so retry is immediate.

# Verification

- Run `yarn test:model-provider`.
- Run the renderer i18n check and touched Node/Web type checks.
- Confirm the cancellation tests cover pre-initialization cancel, active Pi cancel, immediate retry,
  credential-completion tail race, cross-renderer replacement, cleanup failure, and superseded
  renderer result handling.
- Run `git diff --check`.

# Review

- [model-provider-login-cancel-regression-007-1](../reviews/model-provider-login-cancel-regression-007-1.md) -
  pass
