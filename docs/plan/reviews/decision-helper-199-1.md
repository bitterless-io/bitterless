# `decision-helper-199` — independent review 1

Date: 2026-09-24. This is a read-only review by a verifier who did not implement the change. No source, task or doc was edited, nothing was staged or committed, no branch or worktree was switched or created, nothing was stashed, and no app, Electron or E2E was started. This file is the only one written in the repository. Everything else ran on copies in the session scratch directory, which were deleted after the review. No permission request was denied.

Two earlier review attempts on this task were stopped before they wrote a report (the last one at 17:25). This review started from scratch and used neither their trees nor their conclusions. Cowork's round-1 review (`decision-helper-001-1`) was read for context only. Its round-2 review (`001-2`), written while this one ran, was not read.

## Scope basis

Scratch trees, HEAD `883824e8`:

- **`head`**: a `git archive HEAD` export.
- **`wt`**: a copy of the working tree taken at **17:31:08**. This is the state reviewed.
- **`mut`**: a copy of `wt`, used for mutants. Each mutant was restored afterwards, and at the end `diff -rq mut wt` was empty.
- **`probe-nologin`**: `wt` with one file, `src/main/auth/customerSession.service.ts`, taken from HEAD. It was used once, to attribute a guard failure (O7).
- **Cowork**: copies of its four decision files, taken at 17:35:14. They were still unchanged at 18:04:31.

**Changes after the snapshot.** These were neither reviewed nor counted:

- `requestExec.service.ts` (17:53:31) and `snapshotSegment.ts:154-155` (17:53:42): the `# LOADING` note from `snapshot-loading-203`. This is not a hunk of this task.
- `hostToolRegistry.ts`, `tests/maestro/hostToolResultsRecorded.test.mjs`, `tests/maestro/pageSnapshotLoading.test.mjs`, and `docs/plan/tasks/agent-io-tool-results-205.md` / `-206.md`: agent-io-tool-results-205 (as the coordinator announced) and 203.
- At 17:59:21 every other file of this task was byte-identical to the snapshot. At 18:05 the four task test files still passed on the live tree.

**Attribution.** Everything is uncommitted, so hunks were attributed by content, by file mtimes, and by what the 198 and 202 reviews recorded about the 15:09 and 16:59 states.

| File (mtime) | This task's hunks | Other hunks in the file (not reviewed) |
|---|---|---|
| `src/main/decision/decisionHelper.ts` (new, 17:10:19) | the whole file | — |
| `src/shared/decision/decision.api.ts` (new, 16:52:51) | the whole file | — |
| `src/renderer/common/decision/decisionHelper.ts` (new, 15:45:29) | the whole file | — |
| `src/main/xpc/decision.handler.ts` (new, 15:45:29); `jev.handler.ts` deleted | the whole file | — |
| `tests/maestro/decisionHelper.test.mjs` (new, 17:11:23) | the whole file, 23 tests | — |
| `src/main/xpc/xpc.helper.ts` (15:17:37) | `:44-45` | none |
| `src/shared/decision/jev.api.ts` (15:18:12) | the header `:1-11`; `JEV_XPC_HANDLER` and `JevApi` removed | none |
| `src/main/maestro/drive/skillScript.ts` (15:45:41) | the imports `:6-7`; `:188`; the binding `:199-237` | none |
| `src/main/maestro/drive/uiActGate.ts` (16:52:38) | the import `:2`, plus dropping the `JevChoiceAnswer` import and `CONFIDENCE_FLOOR`; `:159-177`; `why` at `:183-188`, which now reads `outcome` | card-198: `:35-136`, `:158`, `:179-182`, `:190-193`, `:198`, `:203`, and the wording inside `why` |
| `src/main/maestro/drive/snapshotSegment.ts` (17:10:39 at the snapshot) | the import `:4`; `CONFIDENCE_FLOOR` removed; `:109-139`, which carries card-198's `decision maker` wording | 203's `:154-155`, which came after the snapshot |
| `src/main/decision/jevDecision.service.ts` (17:04:35) | the header `:7-10` | **card-198:** `:58-70`, `:79-80`, the three messages, and the `logRelayFailure(...)` wraps. **Login-state session:** `:4`, `:92-93`, `:118`. |
| `tests/maestro/decisionMakerCard.test.mjs` (16:28:43) | the `JevHandler` allowlist entry and its comment, removed. Six entries remain (`:1499-1533`). | card-198, card-202 |
| `tests/maestro/uiActWaitHover.test.mjs` (15:26:14) | `:238-242` (`CONFIDENCE_FLOOR` taken out of the declaration list); the stub at `:245-251` | uiact-wait-193, card-198 |

**Other sessions' work, not reviewed:**

- `coach.handler.ts`, `agentDecision.api.ts` and DecisionSheet / DecisionRecord;
- `piRuntimeAdapter.ts`;
- `applicationAuth.service.ts`, `auth.handler.ts` and `customerSession.service.ts`;
- en / zh `todoLimitReached`;
- every other `git status` entry not listed above.

**Card-198 / 202 work kept.** All of it is still in place, and `decisionMakerCard.test.mjs` passes 31/31:

- the decision maker wording;
- `readLabel` and `{ text, shown }`;
- `shootWithin` / `image`;
- the `console.warn` in `logRelayFailure`;
- the session list's 「待确认」 (`SessionsDrawer.vue:161`, en `:616`, zh `:607`). `SessionsDrawer.vue`'s 17:07 edit is 202's F2 comment fix.

**Task:** [decision-helper-199](../tasks/decision-helper-199.md), `status: in-progress`, `depends-on: [decision-maker-card-198]`.

**Contract:** the [feature](../../features/decision-helper.md) #1–#6, as it read at 17:16 (unchanged through the review). #7 (`decideMany`) belongs to qn-006 and is out of scope.

**Also:** the naming rules in [decision-maker-naming-and-approval-card.md](../../features/decision-maker-naming-and-approval-card.md), and the BL rules in `CLAUDE.md` / `AGENTS.md`.

## Conclusion

**pass.**

- **Blocking: none.**
- **Non-blocking: F1–F5, all P3.**
  - **F1:** #4 puts some BJ3 inputs in the wrong bucket, and leaves a few BJ1 note-only changes out. All of them are on the safe side.
  - **F2:** a bare `jev.judge()` with the switch on now makes a relay call instead of failing the script. #4 does not record this.
  - **F3:** five of 56 mutants survive, in three test gaps.
  - **F4:** the lead's decided item, the double negation at `uiActGate.ts:184`.
  - **F5:** readability points for Ral's read.

**What conforms:**

- **No leak.** Relay and network raw text reaches no tool result, activity line, trace, BJ3 card, ERROR, BJ1 text or note, and no renderer return. It appears only in the log. This holds across 20 script shapes × 7 relay replies (0 hits). HEAD, by comparison, leaks 74 times.
- **Sentences.** Every #3 fixed sentence matches the table byte for byte: 37 cases.
- **No input moves to the unsafe side.** Out of 770 BJ3 replies, none goes from "asks" to "runs". Out of 506 BJ1 replies, none goes from "whole snapshot" to "segmented".
- **Requests.** Request bytes are identical before and after in all 1,276 grid replies, and in six real HTTP bodies with `type` placed anywhere.
- **Guards and tests.** The guards catch nine kinds of violation. My own mutants: 51 of 56 killed.
- **Typecheck and ESLint.** Typecheck gives 0 diagnostics in this task's files and none new. ESLint gives 0 errors in the source files.

## 1. Contract check

| Contract | Code | Evidence | Verdict |
|---|---|---|---|
| #2 One implementation in main; sandbox facade; renderer module; no preload instance; nothing in utility / worker | `main/decision/decisionHelper.ts`; the sandbox binding `skillScript.ts:205-237`; `renderer/common/decision/decisionHelper.ts`; no `exposeInMainWorld` and no preload file touched | A grep of `src/preload` / `src/renderer` for the helper finds only the renderer module | ✓ |
| #3 `DECISION_DEFAULT_THRESHOLD = 0.5`; `enabled / judge / choose / check / score` | `decisionHelper.ts:30`, `:226-262`; the interface in `decision.api.ts:67-93` | Tests `:110`, `:363` | ✓ |
| #3 `question` = the Jev question without `type`, plus `name`; the method's `type` wins | `typedQuestion` `:217-224`: `type` deleted, the method's written first | Bytes probe: 6 real HTTP bodies with `type` first, middle, last or wrong are identical to a hand-written `jev.judge`. H7 and H8 killed. | ✓ |
| #3 Strictly greater than; choice / score use `confidence` | `:191` | Test `:110`; H1 killed | ✓ |
| #3 `check` treats yes and no alike: `value = noul > 0.5`, confidence = the chosen side | `readNoul` `:146-151` | Probe: noul 0.02 → decided `false` at 0.98; noul 0.98 → `true` at 0.98. noul 0.3 at threshold 0.7 (confidence exactly 0.7) → `low-confidence`; 0.29 → decided. H2 and H19 killed. | ✓ |
| #3 Threshold outside (0, 1) → 0.5. The note goes after `message` when undecided; decided results have no `message`; a `console.warn` every time | `resolveThreshold` `:67-73`; `withNote` `:75-76` | Sentence probe: 17 threshold shapes. Log probe: one `[coach:decision:helper]` line even when decided. H9, H10, H13 and H15 killed. | ✓ |
| #3 Logs: for http / network / the service's invalid, the helper writes one line with the raw text | `failureMessage` `:98-105` (`:101`) | Log probe: exactly `[coach:decision:helper] ¦ decision maker http 502 ¦ <raw>` | ✓ (also see the lead's item below) |
| #3 Broken reply → `invalid` with the helper's sentence: missing, wrong type, a choice outside `criteria` (own keys), or a probability outside [0, 1] | `isFiniteNumber` / `isProbability` `:108-113`; `readChoice` `:125-132` (`Object.hasOwn`); `readScore`; `readNoul` | Test `:290` (27 shapes); grid below; H3, H4 and H18 killed | ✓ |
| #3 XPC: one object per method; the renderer keeps the positional signature | `decision.handler.ts:27-47`; renderer `:15-21` | Tests `:751`, `:775`; R1–R3 and X1–X3 killed | ✓ |
| #3 The failure direction stays with the callers | The gate asks (`uiActGate.ts:176`); BJ1 falls back to the whole snapshot (`snapshotSegment.ts:128-132`) | The grid below | ✓ |
| #3 `message` never says Jev | — | Test `:345`; leak probe: 0 hits for `/jev/i` outside the logs | ✓ |
| #3 The fixed-sentence table, including `judge()` | `noUsableAnswer` `:87-90`; `failureMessage`; `:205`; `judge` `:243` | Sentence probe: 37/37 byte for byte (§2 item 2) | ✓ |
| #3 `jevDecision.service` only by the helper | `decisionHelper.ts:1` is the only importer | Guard `:838`; mutants GU1–GU5 killed | ✓ |
| #4 BJ3: `choose(riskQuestion, state)` at the default 0.5; the local constant gone | `uiActGate.ts:161-168` | Grid: 0 wire differences; the changes all fall on the safe side | ✓, but #4 misfiles some inputs (F1) |
| #4 BJ1: `choose(blockQuestion, state, { threshold: 0.7 })`; the note is `not segmented (decision maker <reason>[ <status>])`, with no message | `snapshotSegment.ts:110-119`, `:128-132` | Grid: 0 wire differences. Every visible change is one #4 lists. Leak probe notes: `… (decision maker http 502)` / `(… network)` / `(… invalid)`. | ✓, but #4 leaves out a few note-only shapes (F1) |
| #4 Sandbox: `decision` with five methods and `{ threshold }`; `jev` is the same object | `skillScript.ts:205-237` | `jev === decision` (test `:667`); a script's threshold is applied (`:706`); `Object.keys(jev)` lists the five methods | ✓ |
| #4 Sandbox: old `jev.*` usage unchanged, except `message` on failure | — | Sandbox probe against HEAD: a judged result is the same object and the same bytes; failures differ only in `message`. **Exception:** a bare `jev.judge()` with the switch on. | F2 |
| #4 The facade renamed to `DecisionHandler`; the renderer module is new | `xpc.helper.ts:45`; `jev.handler.ts` removed; the renderer module | Test `:805`; X3 and R2 killed | ✓ |
| #5 Unit tests, the source guards, the renderer-module test, typecheck, no E2E | `tests/maestro/decisionHelper.test.mjs` | 23/23; typecheck (§ Verification) | ✓ |

**The lead's decided items, verified.**

- **Two log lines per failure.** This is as described. For every http, network or service-invalid failure, through both `choose` and `judge`, there are exactly two lines:
  - `decision maker relay call failed (http 502): <raw>` (`jevDecision.service.ts:66-68`);
  - `[coach:decision:helper] ¦ decision maker http 502 ¦ <raw>` (`decisionHelper.ts:101`).
  - Off, unauthenticated, a decided result and a helper-level invalid write none.
- **The `uiActGate.ts:184` double negation.** It is still there. It is listed as F4.

## 2. The focus checks

| # | What | How | Result |
|---|---|---|---|
| 1 | Raw relay text is kept away from people and the model | `leak.probe.mjs` drives the **real** `RequestExecService.toolRunSkillScript`, the real sandbox, helper and `jevDecision.service`, with `fetch` mocked. **Replies:** http 502 with a JSON detail, http 500 HTML naming the relay host, 401, a DNS error, a 200 that is not JSON (Node puts a snippet of the body into the SyntaxError), a 200 without answers, and a bad choice. **Script shapes** (`jev.judge` and `decision.judge`): return, throw `message`, concatenation, throw the object, `Object.entries` join. **Also:** `decision.choose / check / score`, BJ3, BJ1, and the `DecisionHandler` returns. Marker `/jev\|relay\.internal\|fcapp\|ENOTFOUND\|Unexpected token\|exploded\|not valid JSON/i`. | **0 hits** in the tool result, the activity line, the traces, `lastAgentRun.replay.errors`, the BJ3 card and ERROR, the BJ1 text and note, and the renderer returns. 260 log lines carry the raw text. HEAD, same probe: **74 hits**. The one contract-sanctioned exception is a *successful* `judge()`, which returns the relay's `model` untouched (O1). |
| 2 | Sentences byte for byte | `sentence.probe.mjs`, 37 cases, BL and Cowork | BL 37/37, including: `(http).` without a status; one space before the note; `NaN`, `-0.2`, `Infinity`, `"0.7"`, `[0.7]`, `null`, `{}`, `10` (BigInt), `Symbol(s)`, `() => 0.7`, and `(unprintable)` ×2. Cowork: see §4. |
| 3 | N4 and BJ3 | `grid.probe.mjs`: HEAD's real gate against the working tree's, the same stub, 770 replies. **Choices:** the three levels, `Irreversible`, `IRREVERSIBLE`, `READ_ONLY`, `toString`, `__proto__`, `constructor`, `hasOwnProperty`, `valueOf`, `isPrototypeOf`, `''`, `' read_only'`, `none`, `delete`, `3`, `0`, `null`, `true`, `{}`, `['read_only']`, missing. **Confidences (33):** including `1.0000001`, `2`, `-0`, `-1`, ±Infinity, NaN, `'0.9'`, `'0.3'`, `''`, `'abc'`, `true`, `false`, `null`, `{}`, `[]`, `[0.9]`, missing. **Plus** 6 relay failures and 5 answer shapes. | **Ask → run: 0.** 42 same, 472 asked before and after with a new reason, 256 ran without asking before and ask now. Every unexpected choice, confidence above 1, negative confidence and non-number asks now. The only replies that still run: `read_only` / `reversible_write` with a confidence in (0.5, 1], and `off`. |
| 4 | Request bytes | Grid: `JSON.stringify({state, model ?? 'jev-latest', questions})` compared, 770 + 506 replies. `bytes.probe.mjs`: actual `fetch` bodies. | 0 differences. The 6 `type` variants are identical to a hand-written question. `threshold` never reaches the wire; `model` does. |
| 5 | #4's behaviour changes | The same grids, plus `sandbox.probe.mjs` (HEAD against the working tree, real service) | BJ1: 24 replies go from segmented to whole: exactly 0.7, above 1, NaN / Infinity, and non-numbers JS reads as ≥ 0.7 or NaN. That matches #4. The rest are note-only, and #4 files some of them wrongly (F1). BJ3: F1. Sandbox: F2. |
| 6 | `check` | `check.probe.mjs`, test `:230` | Yes and no alike; equal to the threshold is undecided (see §1). Aside: at a threshold below 0.5, noul 0.5 is decided "no" at 0.5, which the test comment at `:239` denies (F5). |
| 7 | Cowork consistency | Read and diff; sentence probe on Cowork's helper | §4 |
| 8 | Guards | 11 guard mutants | **Guard 1 catches:** a named import, a relative `import type`, dynamic `import()`, `require`, and a re-export from `src/shared`. **Guard 2 catches:** a renderer emitter, a preload `.ts` string, a control `.vue`, and the old name `JevHandler` in code. **Guard 2 misses:** a preload `.mjs` (F3), and a name built by concatenation (inherent to a text guard). |
| 9 | Attribution | See Scope | The card-198 / 202 work is intact, and no 199 hunk sits in another task's files |
| 10 | The tests are alive | `mutate.mjs`: 56 mutants on `mut`, each checked to have changed its file, restored afterwards. The developer's 15 mutants were not left behind, so overlap cannot be ruled out. | **51 killed.** Survivors: K3 / K4 (`check` / `score` without the abort check after the wait), K6 (the sandbox's `judge` drops `options`), GU9 and GU10 (F3). |

## 3. The developer's claims

| Claim | Verified |
|---|---|
| New files: the helper, `decision.api.ts`, the renderer module, `decision.handler.ts` (a rename of `jev.handler.ts`), and the test file (23 tests) | ✓ 23 tests. `jev.handler.ts` is gone. `decision.handler.ts` is a rewrite with the same role, not a byte-for-byte move; it ends up as a rename in git either way. |
| Modified: `xpc.helper.ts`; `jev.api.ts` (header, with the uncalled `JevApi` / `JEV_XPC_HANDLER` removed); `skillScript.ts` (binding, alias, and 4 old diagnostics at `:188`); `uiActGate.ts` / `snapshotSegment.ts`; `jevDecision.service.ts` (header); `decisionMakerCard` (−2 allowlist lines); `uiActWaitHover` | ✓ There are no other references to `JevApi`, `JEV_XPC_HANDLER` or `JevHandler` in code. The `:188` edit is `decision?.safety` → `decision && decision.safety`, which is equivalent. HEAD had 4 TS2339 there and the working tree has none. The allowlist's dead-entry check would have failed without the removal. For `uiActWaitHover`, the assertions are consistent with an unchanged set (8/8, and the click control still reaches the stub once). That cannot be proven without the pre-199 file, which is untracked. |
| `failureMessage` shared by `ask` and `judge`; raw text only in `console.warn`; a decided `judge` returns the same object; a failure is `{ ...result, message }` with the key order kept; the nameless sentence | ✓ (tests `:363`, `:379`; the log and leak probes) |
| `isFiniteNumber` / `isProbability`; `Object.hasOwn`; [0, 1] | ✓ H3, H4 and H18 killed |
| `typedQuestion`: the script's `type` deleted, the method's first, bytes unchanged | ✓ bytes probe; H7 and H8 killed |
| `shownThreshold`: JSON → `String()` → `(unprintable)` through `attempt` | ✓ sentence probe; H10 killed |
| `judge()` with no argument: `request ?? {}`; off returns `off` and does not throw | ✓. With the switch **on**, it now sends a request (F2). |
| `snapshotSegment.ts:123-130`: the comment rewritten to the facts; `answered` named; `=== true` needed for narrowing under `strict: false` | ✓ **The comment:** the note reaches only `emitTrace({kind:'info'})` (`requestExec.service.ts:357-358`). `capture.service.ts:750-751` returns early for `info`, and the controller's `emitTrace` goes only there (`maestroWindow.controller.ts:1442`, `:2076`). **The narrowing:** a `tsc` probe with the node config gives TS2339 for `!o.decided`, and none for `o.decided === false` or for the aliased `answered`. |
| Test comments follow #4; BJ3 is a 3 × 8 grid; ① has 8 cases, ② has 9 | ✓ `:505-507`, `:518-527`, `:534-545` |
| typecheck: 0 in the changed files, none new; 23/23, 8/8, 13/13, 31/31 | ✓ See Verification. The one new diagnostic in the tree, `homeShellBridge.client.ts(174,29)`, comes from the auth / login work. |
| `skillScopes/execution`: 0/26 on both HEAD and the working tree, different missing stubs; recorded in `docs/issues/unit-tests-hang-after-fixture-drift.md` | ✓ HEAD: `Unexpected fixture dependency: @main/decision/jevDecision.service`. Working tree: `…/decisionHelper`. The issue records it (`:34`, `:37`). **Probe:** with the missing stubs added, both trees pass 25/26 and stop at the same next gap (`documentReader.service`). |
| 76 request comparisons, byte for byte; 15 mutants, all killed | The 76 are plausible: I count 76 byte assertions across the parity tests. My own grids and probes add 1,282 comparisons with 0 differences. The developer's mutants could not be checked; my 56 are in §2. |

## 4. Pairing with Cowork

Cowork files as of 17:35:14, unchanged at 18:04:31. Cowork's round 2 may still change them, so these are facts only; nothing in Cowork was touched.

| Item | BL | Cowork | Verdict |
|---|---|---|---|
| `decision.api.ts` type names | `DecisionOptions`, `DecisionQuestion`, `DecisionFailureReason`, `DecisionOutcome`, `DecisionHelper`, `DecisionJudgeParams`, `DecisionAskParams`, `DecisionApi` | the same | identical |
| Method signatures (`DecisionHelper`, `DecisionApi`) | `enabled()`, `judge(request, options?)`, `choose / check / score(question, state, options?)`; the xpc methods take one object | the same | identical |
| Channel | `DecisionHandler` | the same | identical |
| #3 sentences and log lines | 37/37 | **35/37.** The two `(unprintable)` inputs throw (`Cannot convert object to primitive value`, and the `toString` error), because `shownThreshold` has no third fallback. Every other sentence and log line is identical. | a difference against #3, on Cowork's side |
| `judge()` without a request | `request ?? {}` | `{ ...request }` in `withCallOptions`; `{ ...undefined }` is `{}` | a bare call reaches the service as `{}` in both (Cowork's side read, not run), so F2 applies to both |
| The internal `ask` | one parameter object (BL's rule) | five positional parameters | each follows its repo's rule |
| The renderer module's local name | `handler` | `channel` | naming only (F5 R3) |

## 5. Findings

### Blocking

None.

### Non-blocking

#### F1 — P3 · non-blocking (doc) — #4 files some BJ3 inputs in the wrong bucket and leaves out a few BJ1 note changes

- **Where:** feature #4, the BJ3 row (① / ②) and the BJ1 row.
- **Evidence** (`grid.probe.mjs`, HEAD's real gate and segmenter against the working tree's):
  - **The safe direction holds everywhere.** 0 of 770 BJ3 replies go from asking to running. 0 of 506 BJ1 replies go from whole to segmented.
  - **② is too wide on two counts.** #4 says 「置信度是…字符串等非数 …」 and 「choice 不是三个风险等级之一而置信度高 —— 原来被当成有把握、不问人就执行」. Both cases below already asked before, so they belong in ①:
    - **Some non-number confidences.** `null`, `false`, `""`, `"0.3"`, `[]` and `[0.3]` read as ≤ 0.5 in JS, so the old gate asked ("not confident enough").
    - **A non-string or missing choice at any confidence.** The old `typeof answer.choice !== 'string'` asked, e.g. `{choice: 3, confidence: 0.9}`.
  - **①'s "from" reason is wrong for one case.** For `irreversible` with a broken high confidence (NaN, Infinity, above 1, `"0.9"`, `"1"`, `"abc"`, `true`, `{}`, `[0.9]`; 11 replies), the old card said 「判为不可逆(置信度 X)」, not 「判不准」. The new reason also goes back to the model in the ERROR (`uiActGate.ts:211`).
  - **BJ1 note-only changes #4 leaves out.** These replies were not segmented before either; only the note changes:
    - a valid block with a missing confidence, or with `null` / `false` / `""` / `"0.3"` / `[]` / `[0.3]` (not 「原来照样选段」);
    - `none` with a broken confidence;
    - a missing or non-object answer.
    - The note only reaches a dropped `info` trace, so nobody sees it.
  - **The test knows two of these; the doc does not.** `decisionHelper.test.mjs:514-517` covers the non-string choice and `irreversible` with a broken confidence.
- **Fix:** doc only. State the old and the new rule, so the buckets follow from them. For example:
  - **BJ3 ①:** 「原来：答案缺失、choice 不是字符串、`置信度 ?? 0` 在 JS 比较里 ≤ 0.5,或 choice 是 `irreversible`,就问人;现在：只有判成 read_only / reversible_write 且置信度是 (0.5, 1] 内的数才不问人。① = 两边都问、原因变成「判不了(invalid)」(`irreversible` 配坏置信度原来写「判为不可逆」)」
  - **BJ3 ②:** 「② = 原来不问、现在问：choice 是别的字符串(大小写不同、`toString`、`__proto__` …)而置信度在 JS 里 > 0.5,或置信度 > 0.5 却不是 [0, 1] 内的数(NaN、Infinity、大于 1、`"0.9"`、`true`、`{}`、`[0.9]`)」
  - **BJ1:** 「除上面这些外，坏回包原来也不选段，只是说明变成 `decision maker invalid`」

#### F2 — P3 · non-blocking (behaviour not in #4) — a bare `jev.judge()` with the switch on used to fail the script; now it makes a relay call

- **Where:**
  - `decisionHelper.ts:237`, `request ?? ({} as JevRequest)`;
  - the comment at `:235-236`;
  - test `decisionHelper.test.mjs:411` and `:420-422`.
- **Evidence** (`sandbox.probe.mjs`, real sandbox and service, HEAD against the working tree):

  | Switch | Call | HEAD | Working tree |
  |---|---|---|---|
  | on | `jev.judge()` | `{ok:false, error:"Cannot read properties of undefined (reading 'timeoutMs')"}`, nothing sent | POSTs `{"model":"jev-latest"}` and returns `http 422` |
  | on | `jev.judge(null)` | the same TypeError, nothing sent | the same POST and `http 422` |
  | off | `jev.judge()` | `off` | `off` |

  - #4's sandbox row says 「`jev.*` 旧用法不变，只是失败时的 `message` 改」.
  - The comment at `:235-236` says the service answers 「照常」, and the test comment at `:411` only describes the switched-off case.
  - Cowork's `judge` spreads `request` the same way, so the same holds there (read, not run; §4).
- **Impact:** a nonsense call now costs one relay round trip, which is metered: 「用量按调用方入账」. Nothing leaves the app except `{"model":"jev-latest"}`.
- **Fix, recommended:** add the change to #4's sandbox row in both repos, and reword the two comments.
  - The alternative is a local `invalid` for a missing or non-object request, with no network call. It is a few more lines in two repos, for a call no working script makes.

#### F3 — P3 · non-blocking (test hardening) — five of 56 mutants survive, in three gaps

- **Where and evidence:**
  - **K3 and K4.** Removing the post-wait `ck()` in the sandbox's `check` or `score` (`skillScript.ts:225`, `:231`) leaves the suite at 23/23. The abort test loops over `jev.judge` and `decision.choose` only (`decisionHelper.test.mjs:722`).
  - **K6.** If the sandbox's `judge` drops `options` (`skillScript.ts:212`), nothing fails. No test passes options through the sandbox's `judge`.
  - **GU9.** Guard 2 does not see a preload `.mjs` that names `xpc:DecisionHandler/judge`: `sourceFiles` matches `/\.(ts|mts|vue)$/` (`:815`), and `src/preload` has 38 `.mjs` files.
  - **GU10.** `createXpcRendererEmitter('Decision' + 'Handler')` also passes. That is inherent to a text guard, and acceptable.
- **Fix** (test only):
  - Add `decision.check` and `decision.score` scripts to the loop at `:722`.
  - Add one sandbox call, `decision.judge(req, { model: 'x' })`, and assert `judged[0].model === 'x'`.
  - Widen `:815` to `/\.(ts|mts|mjs|vue)$/`.

#### F4 — P3 · non-blocking (readability; decided by the lead) — the gate's reason still uses a double negation

- **Where:** `uiActGate.ts:184`, `outcome.decided === false && outcome.reason !== 'low-confidence'`, for "the decision maker did not answer".
- **Fix:** name the boolean `answered`, as `snapshotSegment.ts:128` does.
  - `const answered = outcome.decided === true || outcome.reason === 'low-confidence'`, then `!answered ? … : outcome.decided === false ? … : …`.
  - A `tsc` probe confirms that the aliased boolean narrows under BL's `strict: false`.

#### F5 — P3 · non-blocking (readability, for Ral's read)

| # | Where | What | Fix |
|---|---|---|---|
| R1 | `decisionHelper.ts:98-105` | `failureMessage` also writes the raw-text log line (`:101`). At both call sites (`:176`, `:243`) it reads like pure formatting. | Give the name the side effect, e.g. `reportFailure` (logs, returns the sentence). The alternative, moving the `console.warn` to the call sites, duplicates it. |
| R2 | `decisionHelper.ts:235-236`; `decisionHelper.test.mjs:411` | 「由它照常回 off / 判不了」 is only true when switched off (F2). The test's 「the helper threw a TypeError」 describes an intermediate development state, not HEAD. | Reword both with F2 |
| R3 | `renderer/common/decision/decisionHelper.ts:13` | `handler` holds an emitter, not the handler | Call it `decisionEmitter`, BL's `*Emitter` convention (e.g. `renderer/home/src/emitter/setting.emitter.ts:4`, which also casts `as SettingDao`), or `channel` as in Cowork |
| R4 | `skillScript.ts:205` | `decisionMaker` names the `DecisionHelper` facade. But "decision maker" is the user-facing name of the service itself (naming doc #1). It differs from the sandbox name `decision` only because `api.fetch` already has a local `decision` (`:186`). | Call it `decisionBinding`, or add one line saying why it isn't `decision` |
| R5 | `uiActGate.ts:181-182` (card-198's lines, now around 199's code) | 「它只进日志(`jevDecision.service.ts` 记)」. After the migration the gate never receives the raw text: `outcome.message` is already the #3 sentence. The raw text is logged twice, by the service and by the helper. | 「原文只进日志(服务与 helper 各记一条),卡片只写类型和状态(#2)」 |
| R6 | `decisionHelper.test.mjs:239` | 「never above any threshold」 is false below 0.5: noul 0.5 at threshold 0.3 is decided, value `false`, confidence 0.5 (`check.probe.mjs`) | 「never above the default 0.5」 |
| R7 (optional) | `decisionHelper.ts:32`, `jevDecision.service.ts:58`; `decision.api.ts:44` | `JevFailure` is declared twice, and `decision.api.ts` spells out the same `Extract` a third time | Export it once from `jev.api.ts` |

**Checked, no finding (readability):**

- **Comments say why:**
  - the threshold's strictness and origin (`decisionHelper.ts:29`, `uiActGate.ts:159-160`);
  - why JSON is used for the threshold note (`:49-54`);
  - N4 (`:120-124`);
  - yes and no alike (`:141-145`);
  - the method's `type` goes first (`:212-216`);
  - the `strict: false` narrowing (`decision.api.ts:51`);
  - the explicit 0.7 (`snapshotSegment.ts:109`);
  - why `value` is read before the confidence (`:120`);
  - fail-closed stays in the gate (`uiActGate.ts:173-175`);
  - the alias (`skillScript.ts:236`).
- **Local style:**
  - semicolons in `main/decision`, the gate, the segmenter, the handler and the renderer module; none in `skillScript.ts`, like the rest of that file;
  - arrow consts; method shorthand in the handler and the sandbox;
  - `ck()` repeated per method, like `page` / `api`;
  - `for…of`, and no `forEach` (only the TS API `ts.forEachChild` in the test);
  - static alias imports, and `import type` for types;
  - no function over two parameters, except the contract's API (O5);
  - file names with at most two suffixes.
- **ESLint** `--no-cache`:
  - 0 errors in the source files; the new files have no warnings.
  - `skillScript.ts` goes from 110 to 122 Prettier warnings, from following that file's no-semicolon style.
  - The test file has 25 `explicit-function-return-type` errors, the same kind as its siblings.
- **No dead code.** Removed imports (`JevChoiceAnswer`, `isJevEnabled` / `jevJudge` in callers), `JevApi` and `JEV_XPC_HANDLER` had no callers left.
- **The file ends clean:** no trailing whitespace, and a final newline.

### Observations, no finding

- **O1 — `model` on a successful `judge()`.** A successful `judge()` hands the relay's `model` (e.g. `jev-1.13`) to scripts untouched, as #3 says (「判成了的结果原样交回」). A script that returns the whole result puts it into the tool result. Naming #1 treats `model` as an invisible identifier. Lead's call, both repos.
- **O2 — no log for a helper-level `invalid`.** Log probe: a helper-level `invalid`, such as BJ3 now asking because the choice came back `Irreversible`, writes no log line. So nobody can see what the decision maker actually answered. The contract asks for logs only on service failures. Optional: log the offending answer. It contains no relay error text.
- **O3 — `score` is not range-checked.** A 2-level question answering 7 is decided. #3 doesn't require a check, and no caller uses `score` yet.
- **O4 — float noise in `check` messages.** `check`'s `1 − noul` can print noise: noul 0.07 gives confidence `0.9299999999999999`, which lands in a low-confidence `message`. Cosmetic.
- **O5 — three positional parameters.** `choose / check / score(question, state, options?)` have three. BL's rule says over two go into an object, but #3 fixes this signature and Cowork matches it, so it is not a finding. Flagged because Ral will read it.
- **O6 — the naming doc's claim about the BJ1 note.** Naming doc #2 says the BJ1 note goes into the `page_snapshot` header and the activity record. The code shows only an `info` trace, which is dropped (see §3). The new comment at `snapshotSegment.ts:123-124` is right; the doc is stale.
- **O7 — a guard broken by another session.** `scripts/maestro/check-skill-input-vars.mjs` exits 1 in the working tree: `Cannot find module '@shared/home/homeShellBridge.contract'`. HEAD exits 0.
  - **Cause:** the login-state session's `customerSession.service.ts` now imports `./applicationAuth.service`, and the guard's resolver has no `@shared/` rule.
  - **Not 199:** `probe-nologin`, with only that one file taken from HEAD and all of 199 kept, exits 0.
  - Worth telling that session.
- **O8 — status bookkeeping.** The task is `status: in-progress`, and the feature's `Status:` line says 「审查中」. The lead flips both after acceptance. Ral reviews the code next (#5).

### Not verifiable here

- The pre-199 `uiActWaitHover.test.mjs` is untracked and was never snapshotted, so "assertions unchanged" can only be checked for consistency.
- The developer's 15 mutants and 76-comparison count could not be re-run as such.

## Verification (commands actually run)

| Command | Result |
|---|---|
| `rsync` of the working tree → `wt` (17:31:08); `git archive HEAD` → `head`; `wt` → `mut`; `node_modules` symlinked | `diff -rq -x node_modules mut wt` was empty before and after the mutants |
| `node --test --test-timeout=60000 <file>`, one process each (own process group, 180 s cap), `wt` | `decisionHelper` 23/23 · `decisionMakerCard` 31/31 · `uiActWaitHover` 8/8 · `agentDecisionSheet` 13/13 · `skillScopes/execution` 0/26 (`Unexpected fixture dependency: @main/decision/decisionHelper`) |
| The same, `head` | `skillScopes/execution` 0/26 (`… @main/decision/jevDecision.service`). The other four files do not exist at HEAD. |
| The same four task files on the **live** tree at 18:05 | 23/23 · 31/31 · 8/8 · 13/13 |
| `execution` probe copy with the missing stubs added (`jevDecision.service`, `decisionHelper`, `uiActGate`, `snapshotSegment`), `head` and `wt` | Both 25/26, both stopping at `documentReader.service` |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck`, `head` and `wt`; sorted, then `comm` | **Totals:** `head` 97, `wt` 93. **Only in `wt`:** three line shifts (`maestroAgent.service.ts` 1156→1157; `piRuntimeAdapter.ts` 217 / 218 → 219 / 220), and `homeShellBridge.client.ts(174,29)` TS2554, from the auth work. **Only in `head`:** `skillScript.ts(188)` ×4 (fixed here) and `hostIntegration.ts(427)` (197). **0 diagnostics in this task's files.** |
| `tsc -p` a probe config extending `tsconfig.node.json` (on `mut`, removed afterwards) | `!o.decided` → TS2339; `o.decided === false` and the aliased `answered` → no error |
| `eslint --no-cache -f json` on the task files, `wt` and `head` | See F5's "Checked" list |
| `leak.probe.mjs wt` / `head` | `wt`: **0** hits (20 scripts × 7 replies through `toolRunSkillScript`, plus BJ3, BJ1 and the renderer); 260 raw-text lines, all in the log. `head`: **74** hits. |
| `sentence.probe.mjs` (BL `wt`, Cowork's helper copy) | BL 37/37. Cowork 35/37: the `(unprintable)` pair throws. |
| `grid.probe.mjs head wt` | BJ3: 770 replies; 42 same, 472 reason-only, 256 now asking, **0 now running**, 0 wire differences. BJ1: 506 replies; 40 same, 24 segmented → whole, 442 note-only, **0 whole → segmented**, 0 wire differences. |
| `sandbox.probe.mjs head wt` | Judged result: same object, same bytes. Failures: only `message` differs. `enabled()`: same. A bare `judge()` or `judge(null)` with the switch on differs (F2). `judge(req, options)` now honours `options`, which is new with the binding. |
| `bytes.probe.mjs wt` | 6/6 HTTP bodies identical to a hand-written `jev.judge` |
| `check.probe.mjs wt` | See §1 `check` and F5 R6 |
| `logs.probe.mjs wt` (real service, `fetch` mocked) | Two lines for each http / network / service-invalid failure, via both `choose` and `judge`; none for off, unauthenticated, decided or a helper-level invalid |
| `mutate.mjs mut wt`: 56 mutants (22 helper, 6 gate, 5 segment, 6 sandbox, 3 renderer, 3 facade and registration, 11 guard) | **51 killed.** Survivors: K3, K4, K6, GU9, GU10 (F3). |
| Other files that load this task's modules, `head` and `wt` | **Identical in both trees:** `trench-index-layout` 16/19 (same 3 names); `notificationTest` 10/11; `maestroAgentBrowserSession` 0/1 (`Dynamic require of "fs"` in both); `skillScriptInterpreter` 9 tests, 8 pass, 0 fail; `submodulesMainRuntime` 7/7; `check-compaction-wiring` ok; `check-download-destination` ok. **Differs:** `check-skill-input-vars` ok on `head`, exit 1 on `wt`, and ok on `probe-nologin` (O7). |
| `cmp` of this task's files, live against the snapshot, at 17:59:21; Cowork's four files at 18:04:31 | Unchanged, apart from `snapshotSegment.ts:154-155` (203, 17:53:42). Cowork unchanged. |
| `grep` for `forEach`, `import(`, `require(`, trailing whitespace and the final byte, over the task files | Clean |

Not run: E2E, Electron, the app itself, `yarn build`, and Cowork's suites. Cowork's code and its round-1 review were only read. Ral's code review remains the next step.
