---
id: coin-ai-analysis-004
scope: Background Codex structured analysis
status: pending
depends-on: [coin-analysis-workspace-003]
---

# Coin Background AI Analysis

## Objective

Use the connected Codex account to analyze structured Coin evidence behind explicit panel actions,
return strict validated results, and keep all runtime state independent from Maestro without adding
a chat interface.

## Contract

- Implement `CoinAiAnalysisService` with fixed provider `openai-codex`, allowed model/effort values,
  one active bounded run, cancellation, and persisted AI receipts.
- Run with all tools disabled. Do not import Maestro agents, chat contracts, browser/skill/host tools,
  or call `MaestroLlmService.setLlmConfig()`.
- Build a size-bounded snapshot of evidence IDs, facts, scores, missing dimensions, source receipts,
  warnings, and strategy input. Never include stored credentials or arbitrary raw payloads.
- Require `coin-ai-analysis-v1` JSON and validate schema, confidence bounds, output size, and evidence
  references before persistence/rendering. Invalid output is an error, not partially trusted text.
- Render AI interpretation inside the active analysis document with label, model, timestamp,
  confidence, and evidence links. There is no message history, composer, prompt field, new-chat
  action, provider chooser, or stream transcript.
- Deterministic risk gates and HOLD position rules control the final decision; AI cannot bypass them.
- Every Analyze with AI/Cancel action has loading/active feedback and late results cannot overwrite a
  newer receipt.

## Paths

- `src/main/codex/`
- `src/main/coin/ai/`
- `src/main/coin/coinIpc.service.ts`
- `src/shared/coin/`
- `src/preload/coin/`
- `src/renderer/coin/`
- `tests/coin/`
- focused Maestro tests

## Verification

- Prove Coin uses the shared credential but cannot mutate Maestro provider/model/session state.
- Verify bounded context, tool disabling, strict output validation, unsupported evidence rejection,
  cancellation, stale-run rejection, error redaction, and persisted receipt restore.
- Audit source/bundle/accessibility output for absence of chat/composer/provider/tool surfaces.
- Run focused Coin/Maestro tests, `yarn check:maestro`, node/renderer typechecks, build, diff check,
  and AI connected/disconnected/running/error screenshots.

