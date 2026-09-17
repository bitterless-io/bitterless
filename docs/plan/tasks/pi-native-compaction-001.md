---
id: pi-native-compaction-001
scope: Pi native automatic compaction and configurable focus
status: done
depends-on: []
---

# Pi native compaction

Implement [the approved contract](../../features/pi-native-compaction.md) in the current checkout. Preserve all unrelated concurrent edits. Keep Pi native boundaries and persistence, stop the duplicate host scheduler for Pi, and wire the persisted compactPrompt through existing configuration.

Deliver source changes and proportionate code verification, then hand to Ral for human testing. Do not run Electron E2E or independent review. Record commands/results and exact remaining human tests here when complete.

User scope addition: `/test_auto_compact [absolute local text path]` with isolated capped-window native automatic threshold testing, deterministic padding and a measured report; see feature contract.

User scope addition: compaction status bar, queued messages until safe delivery, tool-batch/background-result boundaries, workflow subagent internal compaction disabled.

Historical configuration follow-up (before the 10% recent policy): replace the implicit Codex budget formula with explicit Pi-style ordinary/model configuration. Both budget fields independently accept an absolute count or a host `{ ratio }` extension, resolved to integers before native settings. Effective values were unchanged at that stage; its focused verification is recorded below.

## Delivery evidence — 2026-09-17

Implemented in the current checkout; no branch switch, commit, independent review, Electron E2E or app launch.

- Native Pi 0.85.1 compaction owns threshold/overflow/manual compaction, native cut/prefix/file operations, append/rebuild and persisted named-chat session history. The old renderer scheduler and mutating five-part endpoint are retired. System tables stay in the system slot.
- Persisted compactPrompt uses the existing Models settings surface; blank selects the approved default. The built-in extension snapshots it per run and propagates native failure/cancellation without an unfocused fallback. Main status shows 正在压缩; queued steering is consumed only after actual native delivery. Internal one-shot/scoped/delegate/workflow agents disable compaction.
- /compact is intercepted as a host command. /test_auto_compact [absolute path] uses the CW-shared isolated real-SDK harness, at most64K test window, bounded64KiB source prefix and deterministic padding. It reports the actual threshold, before/after, source size/truncation, provider request phase/status and system/context checks. It cannot receive queued chat messages.
- No separate compaction wall-clock deadline. Native stream/retry/signal policy is retained. Main turn budget and renderer inactivity timer pause during compaction; a received root waiting behind a manual/test compaction no longer expires its3min reservation. Stop and app shutdown cancel the proper session. Electron-XPC1.1.0 has no shorter timeout in this command route.
- Successful chat deletion removes its new native checkpoint via a host endpoint; refused/failed DB deletion does not remove the checkpoint. Existing model-I/O archive policy is unchanged.

Verification:

- PASS67/67: node --test tests/maestro/maestroPiNativeCompaction.test.mjs tests/maestro/maestroPiAutoCompactionTest.test.mjs tests/maestro/maestroRuntimeAdapterContract.test.mjs tests/maestro/maestroQueuedSteering.test.mjs tests/maestro/maestroComposerHistory.test.mjs tests/maestro/maestroCompactionHandler.test.mjs tests/maestro/maestroChatDraftDelete.test.mjs
- PASS1/1: node --test --test-name-pattern='root received during manual compaction' tests/maestro/maestroConcurrentTurns.test.mjs
- PASS19/19 after report UI final edit: node --test tests/maestro/maestroComposerHistory.test.mjs
- PASS: yarn tsc -p tests/maestro/tsconfig.pi-compaction.json --pretty false (runtime, adapter, protocol, native helper, timeout helper, harness and shared contracts;6.53s).
- PASS: node scripts/maestro/check-startup-settings.mjs (including custom compactPrompt persistence/reload and blank reset).
- PASS: scoped git diff --check.
- Full yarn tsc --noEmit --project tsconfig.node.json --composite false --pretty false hit heap SIGABRT before diagnostics (known preload LangGraph issue documented in docs/issues/typecheck-is-a-false-green.md). Existing surface strategy then completed: main/shared63 unrelated diagnostics, Maestro renderer/common/shared4 existing diagnostics (renderer/home omniWindow/shell aliases and shared/pathHelper/main nullable returns). Source logs are /tmp/bl-compact-node-final.log and /tmp/bl-compact-web-final.log; these are not clean project-wide typechecks. The new runtime/shared scope above is clean.
- An exploratory whole maestroConcurrentTurns suite exposed stale fixture dependencies for concurrent applicationAuth/skill-context changes and was interrupted after a stuck test; the compaction-specific reservation case is independently passing. No claim of a clean full suite.
- Real provider/source validation was performed once successfully by the CW worker using the same byte-identical harness, after removing the earlier test-only120s cap: native threshold1,51683→22777 tokens,243s total, system unchanged and context rebuilt. BL did not repeat the paid call.

Human test: run /compact after sufficient chat history; verify status, send two additions while it runs, then inspect their order and /view_context after restart. Run /test_auto_compact with Ral's supplied local transcript path, confirm the isolated bounded-window report, and try Stop/failure and a custom/blank compactPrompt. Verify workflow children do not compact. Electron UI interaction remains for Ral.

## Historical Pi gap follow-up — 2026-09-17 (complete; before recent ratio)

Implemented: guarded Pi0.85.1 prefix-only split previousSummary compatibility; exact /compact [instructions] with per-call focus appended to the persisted/default focus; native retry callbacks and sanitized status lifecycle; model budget resolver for the four selected Codex presets (floor20% real window, keepRecent20000; unknown models Pi default). The isolated harness resolves the same policy against its capped model and reports effective reserve/keep. No dependency upgrade, provider rerun, overall compaction timeout, Electron E2E or independent review.

### Gap follow-up verification

PASS77/77 (17 new focused cases in this follow-up):

`node --test tests/maestro/maestroPiNativeCompaction.test.mjs tests/maestro/maestroPiAutoCompactionTest.test.mjs tests/maestro/maestroPiCompactionPolicy.test.mjs tests/maestro/maestroRuntimeAdapterContract.test.mjs tests/maestro/maestroQueuedSteering.test.mjs tests/maestro/maestroComposerHistory.test.mjs tests/maestro/maestroCompactionStatus.test.mjs`

The installed SDK tests cover repeatedly produced prefix-only split preparations, retained prior summary and usage/details, one-run focus addition, retry success/exhaustion/cancel with redacted credentials, manual/threshold/overflow sharing the resolved budget, capped known-model policy and retry forwarding. Host/UI tests cover exact command boundaries, model-switch/child settings, manual progress without ordinary turns, stale-session suppression, countdown/clear/chat isolation. Retry status uses both existing zh/en i18n dictionaries.

PASS: `yarn tsc -p tests/maestro/tsconfig.pi-compaction.json --pretty false` (4.25s). PASS: `yarn vue-tsc -p tests/maestro/tsconfig.pi-compaction-web.json --pretty false` (5.35s; ChatPanel, ControlApp, ResponseStatus, WorkbenchModelsView and their dependencies). The initial temporary Vue scope omitted the existing Maestro env.d.ts ambient declaration and reported fileBridge; the checked-in scope includes it and passes. No provider call, app launch, Electron E2E or independent review in this follow-up. Root owns the authorized repository sync after handoff.

## Historical absolute/ratio budget configuration — 2026-09-17 (complete; before recent ratio)

Replaced the implicit model set/formula with exported typed `PI_COMPACTION_CONFIG`: ordinary reserve16384/recent20000 plus exact `provider/model` overrides. Each budget independently falls back from model override to ordinary configuration to native default. Both fields accept non-negative safe-integer absolute counts or the host-only `{ ratio }` form (`0 <= ratio < 1`, floored against the selected model's actual window). Only resolved integers reach Pi. The four current Codex entries override reserve with ratio0.2 and inherit recent20000, preserving current behavior. Existing callsites and the isolated capped-model harness keep using the same resolver; no new UI or dependency changes.

Validation rejects invalid absolute/ratio values without coercion and validates ordinary values even when an override replaces them. Exact matching preserves slash-containing model IDs. Ratio/model policies retain an explicit small-window failure without clamps; unknown ordinary absolute defaults keep Pi behavior. Both disabled and enabled resolutions preserve the caller's flag.

- PASS35/35 (policy14, native17, isolated harness4;8 additional policy cases): `node --test tests/maestro/maestroPiCompactionPolicy.test.mjs tests/maestro/maestroPiNativeCompaction.test.mjs tests/maestro/maestroPiAutoCompactionTest.test.mjs` (3.06s). Includes absolute, ratio in both fields, mixed, partial and unknown fallback, exact/slash keys, floor boundaries, invalid values/windows, existing real SDK manual/threshold/overflow/persistence and capped policy paths with simulated streams.
- PASS: `yarn tsc -p tests/maestro/tsconfig.pi-compaction.json --pretty false` (4.53s).
- PASS: scoped `git diff --check` for this policy, its tests and these feature/task documents.

Only the policy, policy test and these two documents changed in this follow-up. No provider calls, app launch, Electron E2E, independent review or Git sync by this worker. The root task owns the requested final sync. Existing owner desktop testing remains the human handoff; this configuration-only change does not add another test requirement.

## Historical budget display and policy revalidation — 2026-09-17 (before recent ratio)

The requested 20% reserve / 20,000 recent-token policy and independent absolute/ratio configuration already exist in the current checkout. Updated the budget reference and provider-limit explanations instead of making a duplicate runtime implementation. The owner waived opening OnlyPreview after its production bridge was unavailable. No additional human handoff or settings UI was added.

- PASS 14/14 policy tests: `node --test tests/maestro/maestroPiCompactionPolicy.test.mjs`.
- PASS 21/21 actual SDK native/harness tests: `node --test tests/maestro/maestroPiNativeCompaction.test.mjs tests/maestro/maestroPiAutoCompactionTest.test.mjs` (2.930s).
- PASS scoped types: `yarn tsc -p tests/maestro/tsconfig.pi-compaction.json --pretty false` (2.38s).
- Offline SDK checks confirmed active exported branch summary requests 4096 tokens and Codex payload omits numerical output/thinking budgets; capture aborted before transport.
- No runtime source changes, live provider requests, full build or Electron E2E. Build was unnecessary for documentation-only changes; prior broad typecheck limitations remain as recorded above. Requested sync is handled by the root task.

## Recent history follows model window — 2026-09-17

Ral approved 20% trigger reserve and 10% recent-history target for the four configured openai-codex models in both Bitterless and CoWork. Update this project's four model overrides to set keepRecentTokens to { ratio: 0.1 }, floored against the actual selected window; leave reserve at { ratio: 0.2 }, unknown models at Pi defaults16384/20000, absolute/ratio configuration support and disabled child sessions unchanged. Windows272000,128000,65536 must resolve to reserve/recent54400/27200,25600/12800,13107/6553; thresholds stay217600,102400,52429. Native message/turn boundaries still choose the retained tail.

Verification must cover all four presets and window rounding, real SettingsManager/preparation propagation for manual/threshold/overflow paths, changed model selection, the capped isolated test, unknown defaults, configurable absolute values and genuinely invalid budget layouts. The former small-window rejection caused solely by a fixed20000 recent target no longer applies. Preserve historical live evidence above with its original budgets. No provider call or Electron E2E is authorized for this implementation.

Implemented the four recent ratio overrides and updated policy/native/isolated/adapter checks. The existing resolver and runtime callsites required no algorithm change. The policy tests pass resolved settings through installed Pi's real SettingsManager, including a272000→128000 model selection then an unknown-model fallback; native manual/threshold/overflow tests inspect the actual preparation settings, and the isolated test confirms recent6553 with unchanged threshold52429. Small windows now scale both Codex values; explicit conflicting absolute budgets still fail visibly.

- PASS50/50 (policy14, native17, isolated4, adapter15): `node --test tests/maestro/maestroPiCompactionPolicy.test.mjs tests/maestro/maestroPiNativeCompaction.test.mjs tests/maestro/maestroPiAutoCompactionTest.test.mjs tests/maestro/maestroRuntimeAdapterContract.test.mjs` (3.10s).
- PASS: `yarn tsc -p tests/maestro/tsconfig.pi-compaction.json --pretty false` (2.26s).
- PASS: scoped `git diff --check`.

No app launch, provider request, Electron E2E or full build was run: this change only adjusts existing typed budget configuration, with the runtime/preparation paths exercised through the installed SDK and simulated responses. Existing owner desktop testing remains as recorded above. Root owns paired CoWork verification, shared budget-reference update and the requested Git sync.
