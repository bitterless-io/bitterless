# Coin Background AI Analysis Result

Status: implemented-owner-verification-pending

## Implemented

- Added a narrow host Codex runtime with fixed `openai-codex`, `gpt-5.5`/`gpt-5.4`, bounded output,
  in-memory sessions, `noTools: 'all'`, no custom/builtin tools, cancellation, and sterile resources.
- Added main-owned structured evidence construction, strict `coin-ai-analysis-v1` parsing, evidence
  validation, sanitized errors, run/revision correlation, and validated-receipt-only persistence.
- Added sender-checked typed AI IPC/preload calls. The renderer can submit only run ID, target ID,
  model, and effort; it cannot submit a prompt, context, provider, credentials, or tools.
- Added Meme/Strategy Analyze with AI and Cancel controls, disconnected routing to Resources,
  persisted interpretation restore, evidence links, unsupported claims, and explicit deterministic
  decision authority. No chat/composer/transcript surface was added.
- Added focused test sources for bounds/redaction, parser/evidence rejection, tool disabling,
  cancellation/stale runs, persistence ownership, Maestro isolation, sender denial, and no-chat
  auditing. These tests were intentionally not run.

## Owner Exercise Steps

1. Open Coin Resources while Codex is disconnected. Confirm only connect/disconnect plus model and
   effort preferences appear; confirm there is no provider selector or chat control.
2. Produce a valid Meme result, click Analyze with AI while disconnected, and confirm navigation to
   Resources. Connect Codex, return to the result, run analysis, and observe loading plus Cancel.
3. Complete a Meme analysis and confirm the AI interpretation shows model, effort, time, confidence,
   evidence links, risks, attention thesis, and unsupported claims without changing its deterministic
   score or source evidence.
4. Produce BUY, HOLD, and SELL Strategy fixtures. Run AI interpretation for each and confirm the
   deterministic decision remains unchanged; specifically confirm HOLD still requires a position and
   hard risk gates still force the deterministic result.
5. Start a run and cancel it. Repeat while closing Coin, disconnecting Codex, logging out, and quitting
   Bitterless; confirm no late interpretation appears or persists after reopening.
6. Reopen a completed Meme/Strategy item from History and confirm its validated AI receipt restores.
7. Exercise malformed JSON, unknown evidence, oversized output, model/effort mismatch, timeout, and
   provider failure fixtures; confirm only a sanitized error appears and no partial text is rendered.
8. Run the focused Coin tests, node/renderer typechecks, build, Electron scenarios, screenshots, and
   source/bundle audits when owner verification is authorized.

## Unverified Risks

- The installed Pi runtime's concrete event/resource-loader behavior has not been exercised against
  the narrow adapter, including cancellation during provider startup and tool-event rejection.
- Vue/TypeScript template inference for the new Resources selectors and interpretation component has
  not been typechecked or built.
- State migration, 4 MB compaction, stale revision races, close/logout/quit aborts, and History restore
  have source coverage and authored tests only; no runtime execution occurred.
- Layout, overflow, focus behavior, evidence scrolling, and bilingual copy have not been inspected in
  Electron at supported viewport sizes.
- No test, lint, typecheck, build, E2E, Electron, git-diff, or other verification command was run.
