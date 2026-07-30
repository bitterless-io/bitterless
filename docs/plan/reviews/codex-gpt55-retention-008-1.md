---
id: codex-gpt55-retention-008-1
status: pass
reviewed_task: codex-gpt55-retention-008
development_commit: 7f6aa69
date: 2026-07-30
review_type: independent-source-and-targeted-runtime
---

# GPT-5.5 Retention Review 1

## Findings

- None. No P1/P2/P3 blocking or non-blocking source finding was identified.

## Contract assessment

- Shared Model Provider remains fixed at `openai-codex / gpt-5.5 / low`
  (`src/shared/modelProvider/modelProvider.contract.ts:1`). The strict stored-record and snapshot
  schemas derive their configured model and fixed target from those constants
  (`src/shared/modelProvider/modelProvider.schema.ts:34`), and Translator derives the same target
  rather than owning a second model preference (`src/shared/translator/translator.contract.ts:1`).
- Translator passes that fixed GPT-5.5 target to the shared runtime with `serviceTier: 'fast'`
  (`src/main/translator/translator.service.ts:177`). The real Pi wire test proves the installed
  provider resolves GPT-5.5 and writes `service_tier: "priority"` only for the Fast request.
- The shared Codex runtime catalog contains GPT-5.5 plus GPT-5.6 Luna, Sol, and Terra. GPT-5.5,
  Luna, and Terra retain `low`, `medium`, `high`, and `xhigh`; Sol correctly omits `low`
  (`src/main/codex/codexRuntime.service.ts:5`). The modern Pi `ModelRuntime` creation and
  `ModelRegistry` adapter path remains intact (`src/main/codex/codexRuntime.service.ts:417`).
- Coin keeps `gpt-5.6-sol / xhigh` as the default, exposes GPT-5.5 as a selectable model, accepts
  all four documented GPT-5.5 efforts, and reserves receipt-only compatibility for GPT-5.4
  (`src/shared/coin/coinAnalysis.type.ts:13`). State normalization therefore preserves stored
  GPT-5.5 and normalizes only unsupported/legacy selections to the Sol default
  (`src/main/coin/state/coinState.schema.ts:500`). The state test covers GPT-5.5 save persistence
  and a subsequent GPT-5.4 normalization without dropping validated receipts
  (`tests/coin/unit/coinState.service.test.ts:103`).
- Maestro keeps GPT-5.6 Luna as the new-install default while restoring a complete GPT-5.5 preset
  (`src/main/maestro/llm/llmModels.ts:71`). Both the chat-target normalizer and the independent
  `coach-settings.json` normalizer accept and preserve stored GPT-5.5 plus supported effort
  (`src/main/maestro/llm/llmModels.ts:233`,
  `src/main/maestro/settings/coachSettings.service.ts:50`).
- Commit `7f6aa69` does not alter the Pi login implementation, credential generation fencing,
  provider connect/cancel state machine, or renderer generation fencing. The existing cancellation
  suite still passes, and the added provider-target assertion exercises the GPT-5.5 snapshot
  without weakening those tests.

## Verification

- `yarn test:model-provider` — passed, 14/14.
- `node tests/coin/run-unit.mjs` — all 20 task-relevant Codex credential, Codex runtime, Coin AI,
  and Coin state tests passed. The full runner remains 67/68 because
  `GMGN regular-wallet rank 1 is retained as independent` fails in the unchanged baseline; the
  same failure reproduces at parent commit `d09937e`.
- `node --test tests/translator/codexFastWire.test.mjs` — passed, 1/1 with the real installed Pi
  provider and GPT-5.5 Fast wire assertion.
- `node scripts/maestro/check-startup-settings.mjs` — passed, including GPT-5.6 Luna default,
  GPT-5.5 preset, target normalization, and persisted Maestro settings.
- `yarn check:maestro` — reaches an unrelated pre-existing Maestro alias-boundary failure before
  its component checks. The identical nine forbidden-host-alias diagnostics reproduce at parent
  commit `d09937e`; none of those files or the alias harness changed in `7f6aa69`.
- `yarn typecheck:node` — passed.
- `yarn check:renderer-i18n` — passed.
- `git diff --check` and `git diff --check d09937e..7f6aa69` — passed.

No Electron process, real OAuth flow, packaging, or publishing command was run.

## Conclusion

**pass**

Commit `7f6aa69` satisfies the GPT-5.5 retention contract without rolling back the GPT-5.6 defaults,
modern Pi `ModelRuntime` support, or the cancellable login state machine. The two full-suite
failures are independently reproduced on the parent baseline and do not block this task.
