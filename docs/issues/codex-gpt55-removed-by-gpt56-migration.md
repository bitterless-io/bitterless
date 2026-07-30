# GPT-5.5 Removed by GPT-5.6 Migration

Status: Implemented; owner verification pending

Implementation: [codex-gpt55-retention-008](../plan/tasks/codex-gpt55-retention-008.md)

## Symptom

The in-progress GPT-5.6 runtime migration replaces every active Codex model catalog with GPT-5.6
models. It also normalizes stored GPT-5.5 selections to a GPT-5.6 default and changes the shared
Translator/Model Provider fixed target away from GPT-5.5.

## Root cause

The migration treats the GPT-5.6 additions as a replacement instead of an extension:

- the shared Codex runtime omits `gpt-5.5`;
- Coin classifies GPT-5.5 as receipt-only history, so a stored GPT-5.5 preference is rewritten;
- Maestro omits the GPT-5.5 preset and rejects a stored GPT-5.5 model during settings
  normalization;
- the shared Model Provider constant changes the fixed Translator target to GPT-5.6 Luna.

## Required behavior

- GPT-5.5 remains a first-class Codex runtime model after GPT-5.6 Luna, Sol, and Terra are added.
- Translator and the shared Home Model Provider retain the accepted fixed
  `openai-codex / gpt-5.5 / low / fast` target.
- Coin exposes GPT-5.5 together with the GPT-5.6 family. A stored GPT-5.5 preference remains
  GPT-5.5; only no-longer-selectable GPT-5.4 preferences normalize to the current Coin default.
- Maestro exposes GPT-5.5 together with the GPT-5.6 presets and preserves a stored GPT-5.5 target.
  The new GPT-5.6 default may remain unchanged.
- Pi `ModelRuntime` compatibility and the cancellable login state machine remain intact.

## Acceptance

- Contract and runtime catalogs contain GPT-5.5.
- Translator labels, fixed target, runtime request, and Fast wire test use GPT-5.5.
- Coin state tests prove GPT-5.5 survives load/save while GPT-5.4 still normalizes.
- Maestro model normalization accepts and preserves GPT-5.5.
- Model-provider, Coin, Translator Fast-wire, Maestro checks, touched type checks, and
  `git diff --check` pass.
