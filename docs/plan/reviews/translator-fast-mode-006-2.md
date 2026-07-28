# Translator Fast Mode 006 — Review 2

## Findings

No P1, P2, or P3 findings.

The Review 1 blocker is resolved at the correct boundary. Translator still explicitly opts every
request into Fast (`src/main/translator/translator.service.ts:189`), while
`enableFastServiceTier` now wraps Pi Agent's final `onPayload` hook
(`src/main/codex/codexRuntime.service.ts:328`) instead of the earlier simple-stream options that Pi
discarded. The wrapper:

- awaits and preserves the original hook's transformed payload;
- applies `service_tier: "priority"` last, so Fast cannot be replaced by an older/default value;
- rejects a missing Agent, an unwritable hook, a skipped hook, and a non-object payload instead of
  returning a Standard result;
- leaves the Agent hook untouched for requests without the Fast opt-in.

The installed Pi 0.79.10 integration test uses a real Pi Agent session, the real
`openai-codex`/`gpt-5.5` provider, and a locally intercepted `fetch`
(`tests/translator/codexFastWire.test.mjs:133`). It confirmed the final Fast request body contains
`service_tier: "priority"` and the following Standard request has no `service_tier` property. The
mock runtime tests independently cover preservation of an existing `onPayload` transformation,
missing-Agent rejection, skipped-hook rejection, and Standard isolation. Source inspection confirms
the assignment/read-back guard handles an unwritable hook and the payload-shape guard rejects null,
arrays, and non-object values before marking Fast as applied.

Coin remains Standard because its `CodexRuntimeRunInput` omits `serviceTier`
(`src/main/coin/ai/coinAiAnalysis.service.ts:241`). No other Main consumer opts in, and fix commit
`2582681` does not modify global Codex configuration, `package.json`, or `yarn.lock`.

## Verification

- Focused Codex runtime tests: 6/6 passed.
- Focused Translator tests, including the real Pi wire probe: 15/15 passed.
- Focused total: 21/21 passed.
- `yarn typecheck:node`: passed.
- `git diff --check`: passed.

## Conclusion

pass
