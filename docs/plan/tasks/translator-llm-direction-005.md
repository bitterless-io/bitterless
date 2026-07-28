---
id: translator-llm-direction-005
scope: omni-translator
status: done
depends-on: [translator-inline-retry-003]
---

# Objective

Replace local character-count direction detection with single-pass LLM semantic direction and
translation, validate the returned target strictly, and reveal the localized `Translate to …`
target only after the current source revision succeeds.

# Context

- `../../../../../areas/agent-runtime/mini-apps/translator/design.md`
- `docs/features/translator.md`
- `docs/issues/translator-llm-direction.md`
- `docs/features/renderer-i18n.md`

# Path

- `../../../../../areas/agent-runtime/mini-apps/translator/design.md`
- `src/shared/translator/`
- `src/main/translator/translator.service.ts`
- `src/renderer/translator/src/store/translator.store.ts`
- `src/renderer/translator/src/App.vue`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `tests/translator/`

# Verification

- Test the strict two-field output schema, including invalid and missing targets.
- Verify the prompt performs semantic auto direction and keeps abbreviation meanings inside the
  translation field.
- Verify Main sends no locally selected target and returns the LLM-selected target.
- Verify the Store clears a stale target on edits/empty input and records it only after success.
- Verify the rail hides the target before success and renders localized `Translate to …` copy
  afterwards.
- Run focused Translator tests, renderer i18n, touched Node/Web type checks, and
  `git diff --check`.
