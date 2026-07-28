# Translator Fast Mode 006 — Review 1

## Findings

### P1 · blocking — Pi's simple-stream adapter drops `serviceTier` before the provider wire request

The product/runtime boundary opts Translator into Fast and injects
`serviceTier: "priority"` into the Pi Agent stream options
(`src/main/translator/translator.service.ts:189`,
`src/main/codex/codexRuntime.service.ts:333`). The real Pi SDK path does not preserve that value to
the provider, however:

1. Pi Coding Agent's session stream function forwards the augmented options into `streamSimple`
   (`node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js:176`).
2. Pi AI's `streamSimpleOpenAICodexResponses` rebuilds those options through `buildBaseOptions`
   (`node_modules/@earendil-works/pi-ai/dist/providers/openai-codex-responses.js:300`).
3. That whitelist omits `serviceTier`
   (`node_modules/@earendil-works/pi-ai/dist/providers/simple-options.js:1`), so the later provider
   check that would write `body.service_tier`
   (`node_modules/@earendil-works/pi-ai/dist/providers/openai-codex-responses.js:342`) receives
   `undefined`.

A no-network probe against the installed Pi 0.79.10 package and its real `gpt-5.5` model confirmed
the loss: the simple-stream path produced `{"has_service_tier":false}`, while invoking the direct
provider stream with the same option produced
`{"service_tier":"priority","has_service_tier":true}`. This means Translator currently completes
requests on Standard instead of Fast without reporting a failure, violating both the Fast
wire-mapping and fail-closed contracts. OpenAI's current Codex source also defines
`ServiceTier::Fast.request_value()` as `"priority"`, confirming that the intended provider value is
correct:
[`config_types.rs`](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs#L447-L470).

The new runtime test stops at a mocked Agent stream function
(`tests/coin/unit/codexRuntime.service.test.ts:81`) and therefore proves only the wrapper injection,
not the installed Pi simple-to-provider adapter or the final request payload. Delivery requires a
path that preserves `priority` through the real adapter, plus a regression test that observes the
provider payload before network dispatch.

## Verification

- `node --test tests/translator/translatorFastMode.test.mjs`: 3/3 passed.
- `node tests/coin/run-unit.mjs`: the five Codex runtime tests passed; the full suite was 64/65
  because the unrelated existing `GMGN regular-wallet rank 1 is retained as independent` test
  failed.
- `yarn typecheck:node`: passed.
- `git diff --check`: passed.
- Commit scope inspection: no global Codex config, `package.json`, or `yarn.lock` change in
  development commit `6008847`; Coin remains unopted-in at its runtime call site.

## Conclusion

blocked
