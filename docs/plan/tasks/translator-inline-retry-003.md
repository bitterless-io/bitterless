---
id: translator-inline-retry-003
scope: omni-translator
status: in-progress
depends-on: [translator-language-direction-002]
---

# Objective

Replace edit-only recovery for retryable Translator failures with a localized inline `Try again`
button that force-submits the current source once through the existing translation lifecycle.

# Context

- `docs/features/translator.md`
- `docs/issues/translator-inline-retry.md`
- `docs/features/renderer-i18n.md`

# Path

- `src/renderer/translator/src/App.vue`
- `src/renderer/translator/src/App.less`
- `src/renderer/translator/src/store/translator.store.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `tests/translator/`

# Verification

- Test retryable versus non-retryable visibility, localized copy, force-retry wiring, busy-state
  suppression, and empty/whitespace source clearing through the real renderer source contract.
- Run Translator-focused tests and the renderer i18n check.
- Run touched Node/Web type checks and `git diff --check`.
