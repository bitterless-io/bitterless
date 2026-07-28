# Translator direction should follow source semantics

Status: fixed

Implementation: [translator-llm-direction-005](../plan/tasks/translator-llm-direction-005.md)

## Report

Translator currently decides direction before the LLM request by counting Unicode character
classes. Character and token dominance are weak proxies for meaning: a short Chinese phrase can
carry the primary intent beside a longer English product name, identifier, or abbreviation. The
Renderer also exposes that local guess as `To Simplified Chinese` before any result exists.

## Fix contract

- Let the same LLM request infer the semantic source language and translate it.
- Do not use character, UTF-8 byte, or token counts as the direction decision.
- Target English for primarily Chinese source content.
- Target Simplified Chinese for primarily English, other-language, or ambiguous mixed content.
- Ignore the length dominance of product names, abbreviations, code identifiers, URLs, email
  addresses, numbers, and punctuation when identifying the primary natural-language content.
- Require one strict JSON result with exact `targetLanguage: "en" | "zh-CN"` and a non-empty
  `translation`; reject malformed or extra output without a local fallback.
- Keep the existing English-abbreviation Chinese-interpretation rule when the inferred target is
  Simplified Chinese.
- Before a successful result for the current source revision, show only `Auto direction`.
- After success, show the returned target as `Translate to English` or
  `Translate to Simplified Chinese`.
- Hide the previous target immediately when the source is edited or cleared.

## Acceptance

- The request contains auto direction and source data, not a locally selected target.
- The prompt defines semantic direction, mixed/other-language fallback, abbreviation handling, and
  strict two-field output.
- Invalid or missing `targetLanguage` fails as `invalid-output`.
- A completed result transports the validated target to Renderer.
- Empty, edited, loading, and failed-without-result states do not display a target.
- A successful current result displays the localized `Translate to …` label.
- Focused contract, prompt, store, and renderer tests plus touched type checks and
  `git diff --check` pass.

## Resolution

- Translator now sends `direction: "auto"` with source data and asks one sterile LLM request to
  infer the primary semantic language and translate it.
- Main strictly validates the returned `targetLanguage` and `translation`; malformed, missing,
  extra, or unsupported target values fail without a character-count or token-count fallback.
- The old shared Unicode classifier and all production references were removed.
- Renderer stores a nullable target from the completed result. Source edits, empty input, and
  provider invalidation clear it, so the rail shows only `Auto direction` until the current source
  succeeds and then reveals the localized `Translate to …` label.
- Independent review found no P1, P2, or P3 findings. Translator direction tests pass 6/6, retry
  tests pass 5/5, Renderer i18n and Node type checking pass, and the Web type check reports only
  unrelated baseline diagnostics. See
  [translator-llm-direction-005 round 1](../plan/reviews/translator-llm-direction-005-1.md).
