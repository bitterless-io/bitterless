# Translator language-direction detection selects the wrong fallback

Status: in progress

Implementation: [translator-language-direction-002](../plan/tasks/translator-language-direction-002.md)

## Report

Translator currently detects direction independently in Main and Renderer with Unicode
`Script=Han` / `Script=Latin` property expressions. It compares only those two counts, so
punctuation, numbers, emoji, and non-Chinese/non-English scripts disappear from the decision.
Inputs without a Latin majority therefore default to English even when the source should use the
Simplified Chinese fallback.

## Fix contract

- Classify code points through explicit Unicode ranges rather than Unicode Script property
  expressions.
- Count CJK Unified Ideographs, extensions, and compatibility ideographs as Chinese.
- Count only ASCII `A-Z` and `a-z` as English.
- Count every other non-whitespace code point as other; ignore whitespace.
- Target English only when the Chinese count is strictly greater than both the English and other
  counts.
- Target Simplified Chinese when English or other characters dominate, when counts tie, or when no
  visible code point is classified.
- Use one shared classifier in Main and Renderer so the rail cannot disagree with the model request.
- When an English abbreviation or acronym targets Simplified Chinese, require the translation to
  list its common Chinese interpretations, include established English expansions when useful,
  order the general meaning first, and never invent expansions.

## Acceptance

- Chinese-majority input targets English.
- English-majority input targets Simplified Chinese.
- Emoji-, digit-, punctuation-, Japanese-, or other-script-majority input targets Simplified
  Chinese.
- Mixed inputs with tied leading counts target Simplified Chinese.
- CJK extension-plane characters count as Chinese.
- Common English abbreviations produce concise Chinese meaning lists inside the validated
  `translation` string; ambiguous abbreviations include only genuinely common meanings.
- Focused unit tests, Node/Web type checks for touched boundaries, and `git diff --check` pass.
