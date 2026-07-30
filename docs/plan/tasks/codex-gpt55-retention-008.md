---
id: codex-gpt55-retention-008
scope: shared-codex-runtime
status: implemented-owner-verification-pending
depends-on: [model-provider-login-cancel-regression-007]
---

# Objective

Keep GPT-5.5 as a first-class model while retaining the in-progress GPT-5.6 runtime additions,
including the fixed GPT-5.5 Translator/Model Provider target and persisted GPT-5.5 selections in
Coin and Maestro.

# Context

- `docs/issues/codex-gpt55-removed-by-gpt56-migration.md`
- `docs/features/model-provider.md`
- `docs/features/translator.md`
- `docs/features/coin.md`
- `docs/features/maestro.md`

# Path

- `docs/INDEX.md`
- `docs/issues/codex-gpt55-removed-by-gpt56-migration.md`
- `docs/features/model-provider.md`
- `docs/features/translator.md`
- `docs/features/coin.md`
- `docs/features/coin-layout.md`
- `docs/features/maestro.md`
- `docs/plan/README.md`
- `docs/plan/analysis/translator.md`
- `docs/plan/tasks/codex-gpt55-retention-008.md`
- `src/main/codex/`
- `src/main/coin/`
- `src/main/maestro/`
- `src/shared/coin/`
- `src/shared/modelProvider/`
- `src/renderer/common/i18n/`
- `tests/coin/`
- `tests/translator/`

# Implementation

- Add GPT-5.5 to the modern shared Codex runtime catalog and its supported effort map without
  removing GPT-5.6 Luna, Sol, or Terra.
- Keep the shared Model Provider and Translator target fixed at GPT-5.5 low with Translator Fast
  service tier.
- Keep GPT-5.5 selectable and persistable in Coin; reserve the receipt-only compatibility list for
  GPT-5.4 and keep the current GPT-5.6 Sol default.
- Restore the GPT-5.5 Maestro preset and accept stored GPT-5.5 settings while retaining the current
  GPT-5.6 default and presets.
- Preserve all Pi `ModelRuntime` migration work and all login cancellation/generation fencing.

# Verification

- Run `yarn test:model-provider`.
- Run the Coin Codex runtime, credential, AI analysis, and state unit tests.
- Run `node --test tests/translator/codexFastWire.test.mjs`.
- Run `yarn check:maestro`.
- Run `yarn typecheck:node`.
- Run `yarn check:renderer-i18n`.
- Run `git diff --check`.

# Review

- [codex-gpt55-retention-008-1](../reviews/codex-gpt55-retention-008-1.md) - pass
