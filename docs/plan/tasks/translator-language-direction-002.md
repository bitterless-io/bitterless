---
id: translator-language-direction-002
scope: omni-translator
status: in-progress
depends-on: [translator-miniapp-001]
---

# Objective

Replace duplicated Translator Script-property detection with one explicit Unicode-range classifier
that sends Chinese-majority input to English and all English-, other-, tied-, or unclassified input
to Simplified Chinese.

# Context

- `docs/features/translator.md`
- `docs/issues/translator-language-direction-detection.md`

# Path

- `src/shared/translator/`
- `src/main/translator/translator.service.ts`
- `src/renderer/translator/src/store/translator.store.ts`
- `tests/translator/`
- `package.json`

# Verification

- Unit-test Chinese, English, other-script, symbol/digit, whitespace, tie, and CJK extension-plane
  cases through the shared classifier.
- Run the focused Translator unit tests.
- Run Node and Web type checks for the touched boundaries.
- Run `git diff --check`.
