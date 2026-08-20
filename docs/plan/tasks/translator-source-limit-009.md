---
id: translator-source-limit-009
scope: omni-translator source input bound
status: implemented
depends-on: [translator-thinking-off-008]
---

# Objective

Lower Translator's source-input bound from 12,000 to 1,000 Unicode code points so one request stays
comfortably inside the exact 60-second deadline and long documents are translated in owner-chosen
slices instead of one oversized request. Keep the 24,000-character translation ceiling and the
64KB output-byte guard unchanged.

# Context

- `docs/features/translator.md`
- `docs/issues/translator-timeout-and-thinking-off.md`
- `../../../../../areas/agent-runtime/mini-apps/translator/design.md` — "bounded source text",
  no numeric contract, so no cross-project design change is required

# Path

- `src/shared/translator/translator.contract.ts`
- `tests/translator/translatorLanguage.service.test.mjs`
- `docs/features/translator.md`
- `docs/plan/README.md`
- `docs/plan/tasks/translator-source-limit-009.md`

# Implementation Constraints

1. `TRANSLATOR_MAX_SOURCE_LENGTH` is the single source of the bound. Renderer clamping
   (`setSourceText`, textarea `max-length`, the `n / limit` counter) and the Main Zod schema both
   derive from it; no second literal is introduced.
2. The schema keeps its `TRANSLATOR_MAX_SOURCE_LENGTH * 2` UTF-16-unit pre-check, so the raw-string
   bound follows to 2,000 automatically and surrogate-pair input still cannot bypass the contract.
3. `TRANSLATOR_MAX_TRANSLATION_LENGTH` stays 24,000. A 1,000-character Chinese source legitimately
   expands well past its own length in English, so scaling the output ceiling with the input bound
   would reject valid translations.
4. No chunking, splitting, or queueing feature is added in this task; slicing long input stays a
   manual owner action.

# Verification

- `node --test tests/translator/*.mjs` for the source-text and schema suites, excluding the
  pre-existing unrelated `translatorErrorDetail` failure on this branch.
- `yarn typecheck:node`.
- `git diff --check`.
- Owner check: the composer counter reads `n / 1000`, pasting a longer passage clamps at 1,000
  characters, and a normal short paragraph still translates.

# Outcome

- `TRANSLATOR_MAX_SOURCE_LENGTH` is now `1_000`; the renderer counter, clamping, and Main validation
  all follow from that one constant.
- The feature contract documents the shorter bound, its 2,000 UTF-16-unit companion, the reason
  (deadline plus sliced long input), and why the translation ceiling stays at 24,000.
