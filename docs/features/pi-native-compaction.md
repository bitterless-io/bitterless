# Pi native automatic compaction

- Status: implemented and code-verified on 2026-09-17; owner desktop UI testing pending.
- Authority: overmind areas/agent-runtime/chat/compaction.html and prompt-structure.html#compact-prompt-default.
- Scope: Pi-backed chat runtime in Bitterless and CoWork; AI-CRMS keeps its current behavior.

## Contract

Pi AgentSession is the sole automatic compaction scheduler. Use the installed Pi 0.85.1 native threshold/overflow logic with SettingsManager.inMemory({ compaction: resolvePiCompactionSettings(model) }). The explicit PI_COMPACTION_CONFIG below resolves each budget independently against the active model's real window, again for every new/model-switched session. Pass only integer token counts into Pi; disabled child sessions remain disabled. Retire the host's old automatic and custom five-part compaction path for Pi; manual chat compaction also delegates to native Pi. Preserve existing stored histories.

The complete main system prompt (including prompt-structure table 2) stays outside summary input and unchanged under unchanged effective configuration. D1-D4 remain historical message snapshots and can be summarized.

Expose a persisted host compactPrompt string through the existing chat configuration surface. Missing or whitespace-only values use the default below. Snapshot at the start of each compaction. This is an additional focus for the native history summary, not a replacement for Pi's templates and not part of the main system prompt. The native split-turn prefix template does not accept this focus; preserve that limitation.

Register one built-in session_before_compact extension through the existing resource loader without enabling filesystem extensions. Call the exported native compact helper with the current model, credentials, headers, cancellation signal and streaming/runtime options. Return { compaction: result }; Pi alone appends the entry and rebuilds context. Do not call session.compact inside the hook. Since Pi skips fromHook details when recovering file operations, carry forward only this host's marked previous compaction readFiles/modifiedFiles using cloned native preparation Sets. Preserve native details and usage.

Normalize native compaction_start/end including estimatedTokensAfter, aborted and sanitized errorMessage. Pass native retry callbacks to compact; expose scheduled attempt/maxAttempts/delay/error and clear retry status on attempt start, retry finished, end, cancellation and reset. Ignore progress from a previous session; manual and isolated-test paths also report status without a running ordinary turn. Preserve steering, failure reporting, effective context preview and persistence/reload behavior. Do not migrate, erase or reinterpret historical raw messages.

No new chunker, alternate summarization model, dependency upgrade, fixed five-segment budget or absolute never-overflow guarantee. The explicit model budget configuration below is the approved settings override. Pi may still fail if the summary request itself exceeds the model window; fail visibly without committing a partial compaction.

## Explicit model budget configuration

`src/main/agent/runtime/piCompactionPolicy.ts` exports a typed `PI_COMPACTION_CONFIG`. Its ordinary values and exact `provider/model` overrides follow Pi's per-field precedence: matching model field, ordinary field, then native default (reserve16384, recent20000). A model id containing `/` remains part of the complete exact key. Omitting either override field leaves its independent fallback intact.

```ts
export const PI_COMPACTION_CONFIG: PiCompactionConfig = {
  reserveTokens: 16384,
  keepRecentTokens: 20000,
  modelOverrides: {
    'openai-codex/gpt-6-astra': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } },
    'openai-codex/gpt-5.6-sol': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } },
    'openai-codex/gpt-5.6-terra': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } },
    'openai-codex/gpt-5.6-luna': { reserveTokens: { ratio: 0.2 }, keepRecentTokens: { ratio: 0.1 } },
  },
};
```

Both `reserveTokens` and `keepRecentTokens`, in either ordinary or model configuration, accept an absolute non-negative safe integer or `{ ratio: number }` with `0 <= ratio < 1`. Ratio is a host convenience, not a Pi SDK field: resolve it with `floor(model.contextWindow * ratio)` before calling SettingsManager. For example, `{ reserveTokens: 8192, keepRecentTokens: { ratio: 0.1 } }` is valid. This is code configuration only; no new settings UI or SDK upgrade.

The approved configuration for the four Codex models is 20% reserve and 10% recent tokens, independently floored against the active window. The recent ratio replaces their previously inherited fixed 20,000-token value; other keys still inherit 16384/20000. At windows 272000, 128000 and 65536, reserve/recent resolve to 54400/27200, 25600/12800 and 13107/6553 respectively. Recent tokens are Pi's target for retained message history, not an exact partition: native turn boundaries still determine the cut. Invalid values are rejected without coercion, including invalid ordinary values masked by a valid override. Ratios and matched overrides require a positive safe-integer model window; if their selected reserve plus recent count leaves no room, fail explicitly instead of clamping. Unlisted models using ordinary absolute values retain native behavior. Both fields remain independently configurable as absolute values or ratios.

The 10% recent policy is code-verified: 50 focused checks pass (14 policy, 17 native, 4 isolated harness and 15 adapter contract), including actual SettingsManager values and native compaction preparations, plus the scoped runtime TypeScript check. No live provider or Electron test was run; see the [task record](../plan/tasks/pi-native-compaction-001.md) for exact commands and historical results.

## Budget reference verification — 2026-09-17

The owner's latest follow-up changes the current Codex policy to reserve 20% of the actual window and target 10% for recent history. Both fields support absolute values or host ratios. The companion compaction.html includes an interactive calculation and a table of the other Pi context controls, updated for the same policy. The owner explicitly waived opening OnlyPreview for this round; no additional settings UI is needed.

At contextWindow 272,000, the resolved reserve is 54,400, recent target is 27,200 and the native strict-greater-than threshold is 217,600. History/prefix summary request options are respectively 43,520 and 27,200. These are SDK request budgets: installed pi-ai's openai-codex-responses adapter does not put maxTokens into its final payload, so they are not enforced Codex wire output caps. Codex sends reasoning effort, not numerical thinkingBudgets. Generic simple provider options can shrink output by estimated input and a 4,096-token margin; that is not an exact request-size guarantee.

Use the actual pi-coding-agent/core import path as the source of truth. Its branch-summary output request is min(4096, model.maxTokens), independently verified through the exported function in both products. The separate pi-agent-core/harness implementation's 2048 value is not the active path. Neither branchSummary.reserveTokens nor system/skills/tool-size limits are additional partitions of the main compaction reserve.

Pi 0.85.1 accepts absolute compaction settings only. The official latest documentation's modelOverrides feature belongs to upstream Unreleased; host modelOverrides and ratio resolution remain necessary without an SDK upgrade. Actual chat uses SettingsManager.inMemory through piRuntimeAdapter. Legacy piCompactionSettings.service.ts and compressionRemainingPercent are not sources for these native budgets.

Sources: [stable settings](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/settings-manager.ts), [branch summary](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/compaction/branch-summarization.ts), [Codex payload](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/openai-codex-responses.ts), [simple options](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/simple-options.ts).

## Native-design acceptance — 2026-09-17

Ral confirmed retaining Pi's existing design and syncing once the implemented compaction scope has no outstanding integration gap relative to Pi. Keep the existing four Codex overrides at 20% reserve / 10% recent history; the later budget discussion does not change these shipped values. Keep native summary generation, cut points, persistence, bounded retry and the approved compatibility hooks.

The prefix-only compatibility hook matches [Pi's upstream fix](https://github.com/earendil-works/pi/blob/e98f287ee498e0116546f4e9aa083fdec9793cd2/packages/coding-agent/src/core/compaction/compaction.ts#L903): retain the previous summary when no complete history is being summarized, then merge the new turn-prefix summary. Its possible growth, provider-specific output enforcement and lack of a final combined-summary budget check are accepted native limitations. Do not add chunking, a post-summary shrinking loop or a new output-cap policy in this delivery.

## Manual command

Ral explicitly requested `/compact` and then `/compact [instructions]` on 2026-09-17. Match the exact command boundary, allowing an optional instruction suffix; paths or longer names remain ordinary input. Intercept this command in the chat composer as a host control action. Use the same native Pi compaction, append the per-call instructions to the persisted/default compactPrompt and snapshot both before asynchronous work. Never persist the per-call addition or reuse it next time. Display start/result/error/cancellation, do not send the literal command as a user task, and do not race an active turn. Clearly reject unsupported AI-CRMS.

## Automated threshold test command

Ral additionally authorized a test plan and implementation on 2026-09-17. Support `/test_auto_compact` and `/test_auto_compact <absolute UTF-8 text/JSONL path>` (quoted paths with spaces). Create an isolated temporary native Pi session using the selected provider/model/auth, system and compactPrompt, no tools. Keep production conversation/settings unchanged. Treat source transcript as inert historical data, read at most the first 64 KiB without loading the full file, and report included/total bytes. Use a deterministic fixture when the path is absent.

Set only the test session's contextWindow to min(actual contextWindow, 65536), then apply the same policy resolver to that cloned capped model. For the four listed Codex keys a65536 test window yields reserveTokens13107, keepRecentTokens6553 and threshold52429; production still resolves against the real window (272000 yields reserve54400/recent27200). Other keys keep Pi defaults. Refuse windows too small for this layout. Fill completed historical turns and a retained tail with explicitly labelled deterministic test padding until the native estimate exceeds the native threshold + 512 tokens. Do not forge provider token usage. Invoke a normal prompt and require the SDK's real automatic threshold path; no manual compact call or direct hook invocation. Request only a minimal continuation, trigger one automatic compaction with native bounded summary retries, and stop on failure/cancellation. Do not impose a host total-compaction deadline. User messages arriving during the test remain queued for the original chat; never send them to the temporary fixture session.

Return measured provider/model, actual/test window, effective reserve/keepRecent, threshold, before/after estimate, source/truncation/padding metrics, native compaction events, summary size, unchanged system and native context rebuild checks. Never log raw source or credentials. Clearly label the capped-window test as mechanism verification, not proof of full real-window capacity, semantic losslessness or never-overflow. The user-triggered command uses real selected-model usage; automated code tests use real SDK with simulated model streams. AI-CRMS explicitly unsupported.

## Compaction concurrency and child sessions

Ral explicitly requested this behavior on 2026-09-17. Show a main-chat status bar compaction state for native start/end. During compaction, submitted user messages retain queued status and FIFO order; do not deliver them to the summary input or steer immediately. Release only after compaction settles into the safe active-turn or next-turn path. Mark delivered only when the runtime consumes the message. Failure/cancel must release the gate without losing or duplicating messages.

Keep Pi's tool boundary: await the entire tool batch and record its results before the next-assistant automatic compaction check, retaining legal tool-call/result pairs. Main chat compaction does not stop background workflows. Completions arriving during it remain in the background inbox and deliver once after it settles. Never copy the entire child history into the parent.

Explicitly disable both threshold and overflow auto compaction in workflowEngine/piAgentSession.ts child sessions. These independent subagent attempts may fail visibly on context overflow using the existing error path; no hidden fallback compression. The parent chat remains enabled. Check queue/status success, cancellation, failure, tool batch boundaries, background completion and child settings with focused tests.

## Timeout and cancellation policy

Ral requested Pi coding agent semantics on 2026-09-17. The installed Pi 0.85.1 compaction has no separate overall deadline. Use the session's actual streamFunction wrapper with the native AbortSignal, inherited provider request settings and retryAssistantCall policy. SDK timeout precedence: request timeoutMs, retry.provider.timeoutMs, then httpIdleTimeoutMs (default300000ms). This is network/provider timeout behavior, not a five-minute overall compaction promise. Default summary retry policy is enabled, maxRetries3, baseDelay2000ms; provider maximum retry wait defaults60000ms. Do not add a 120/300-second host timer or external retry loop. The test command triggers one compaction and may use the bounded native summary retries within it.

Stop aborts native compaction/test and restores queue delivery without committing a partial summary. XPC and normal-turn watchdogs must not terminate active compaction using an unrelated short timeout. The first live test was cancelled by the initial test harness120s timer and is historical evidence only, not a Pi timeout failure.

## Default compactPrompt

```text
Preserve unfinished, uncancelled user requests and commitments, including parallel work; later silence is not cancellation. Newer instructions replace only conflicting parts.

Distinguish verified results from attempts and plans; retain blockers, uncertainty, and the next concrete action. Keep exact references needed to resume.

Treat D1-D4 (time, workspace, active tab, open tabs) as message-time snapshots, not current state.

Keep still-relevant prior context, remove repetition, and never invent facts.
```

## Verification

Use real installed Pi with simulated model responses where feasible: threshold and overflow paths, default/custom/blank focus, main system protection, split turns, repeated file-operation carry-forward, failed/aborted runs and continuation. Check config persistence, native compaction context persistence/reload, and old Pi automatic path bypass. Run relevant unit/integration tests and scoped type checking. No Electron E2E or app launch; Ral owns live human testing. No independent review is requested.

## Historical live source validation (2026-09-17, before model budget policy)

This earlier live run used reserve16384 and keepRecent20000. The new model budget policy was verified with simulated providers only, without another paid call. Shared harness verified through the CoWork production Pi target (openai-codex/gpt-6-astra/max), actual composed system, isolated no-tool session and a bounded64KiB sample from the owner-supplied30.4MB Claude record. Actual/test window272000/65536; native threshold49152; exactly one automatic threshold event; Pi estimated context51683→22777tokens; summary9027chars; unchanged system and rebuilt context both true. Summary completed233.1s, total243.0s, two requests (summary and short continuation), HTTP200. No app launch or original-chat/settings mutation. This is not a full-window capacity/semantic-losslessness or desktop UI test. First attempt was stopped by the superseded120s harness timer; the native-policy retest succeeded.

## Historical Pi gap follow-up — 2026-09-17 (complete; before recent ratio)

Implemented and verified: guarded Pi0.85.1 prefix-only split previousSummary compatibility; exact /compact [instructions] with per-call focus appended to the persisted/default focus; native retry callbacks and sanitized status lifecycle; model budget resolver for the four selected Codex presets (floor20% real window, keepRecent20000; unknown models Pi default). The isolated harness resolves the same policy against its capped model and reports effective reserve/keep. No dependency upgrade, provider rerun, overall compaction timeout, Electron E2E or independent review.

The removable0.85.1 compatibility guard changes only the native returned summary when isSplitTurn, a nonempty turn prefix, zero messagesToSummarize, a non-nullish previousSummary and the exact native missing-history prefix all match. It restores the previous summary, including the empty-string case, while keeping usage/details. Already-correct native output is not duplicated, even if the prior summary itself begins with the native missing-history prefix. The real installed SDK and SessionManager regression exercises this condition repeatedly.
