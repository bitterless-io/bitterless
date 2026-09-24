# `decision-helper-199` — independent review 2

Date: 2026-09-24. This is a read-only review of round 2, the last polish before Ral reviews the code: review 1's F2–F5 (R1–R6) plus O2 / Cowork review N4 (the helper logs its own `invalid`). The verifier did not implement it. No source, task or doc was edited; this file is the only one written in the repository. Nothing was staged, committed or stashed, no branch or worktree was switched or created, and no app, Electron or E2E was started. Everything ran on copies in the session scratch directory, deleted at the end. No permission request was denied.

## Scope basis

**Trees** (scratch):

- **`snap`**: the files this review reads — the five changed files, both contracts, the task and review 1 — copied at **18:47** (seconds after the review started at 18:47:24). This is the state reviewed.
- **`cur`**: the working tree, rsynced at 18:51:31 (`node_modules` symlinked; `dist`, `out`, `build`, `tmp`, `external_tools`, `output`, `.git` left out). Its five files are byte-identical to `snap`.
- **`before`**: `cur` with this round's hunks, and only those, taken back out of the five files. Three of the files are untracked, and the two tracked ones also carry earlier hunks (card-198, 199 round 1), so git has no baseline. I rebuilt it by reverse-applying the developer's 31 `Edit` calls, newest first. They were read, read-only, from the developer's session transcript, and each `new_string` matched exactly once. The anchors below were not produced by that reversal.
- **`head`**: `git archive HEAD` (`883824e8`) of `src/`, used only for the #4 bucket check (§2 item 7).
- **`mut`** (my mutants) and **`devmut/{mut-before,mut-after}`** (the developer's 14, re-run): each mutant was restored afterwards, and `diff -rq` against the source tree was empty at the end.
- **Cowork**: read-only copies of six decision files, taken at 18:53:27. The helper (18:41:46, `dc5bf6e8`) was still unchanged at 19:14:12.

**Anchors for `before`:**

| File | Anchor | Match |
|---|---|---|
| `renderer/common/decision/decisionHelper.ts` | a 15:45:29 copy kept by an earlier review (`rv199-1/after`) | sha256 `253ec05d…` identical |
| `skillScript.ts` | a 15:45:41 copy (`rv-205-1/pre`, taken before this round reached the file) | `0e632e2f…` identical |
| `decisionHelper.test.mjs` | a 17:11:23 copy (`rv-205-1/pre`); 17:11:23 is the mtime review 1 recorded | `ef6e932e…` identical |
| `decisionHelper.ts` | the developer's `cat -n` at 18:17:01 (before any edit), and the sha256 it printed before editing | identical; `984351ff…` |
| `uiActGate.ts` | the developer's pre-edit sha256; its reads of lines 10–215 before editing; and the 18:28:30 copy (`rv-205-1`), which sits between its two edits | `1984b428…`; 217 lines, 0 mismatches; after reversing only the second edit, `b2453a95…` identical |
| all four source files and the test | every line reference in review 1 (helper `:67`…`:243`, gate `:159`…`:188`, test `:239`…`:838`) | each lands on the same code in `before` |

**Changes after the snapshot.** None in the reviewed files. At 19:13:34, all of the following were still identical to the copies: the five files, both contracts, the task, `snapshotSegment.ts`, `jevDecision.service.ts`, `decision.handler.ts` and `decision.api.ts`.

Other sessions' files may have moved in the live tree during the review; they are not reviewed. They include 205's `hostToolRegistry.ts` and friends, 204 / 206's `piRuntimeAdapter.ts` / `builtinToolResultHook.ts`, 203's `# LOADING:`, and the login-state files. `before` and `cur` share one copy of each such file, so none of them can produce a before/after difference below.

**Attribution** (this round's hunks, from the reversal):

| File (mtime) | This round's hunks | Other hunks in the file (not reviewed) |
|---|---|---|
| `src/main/decision/decisionHelper.ts` (untracked, 18:28:10) | `:92-100` (doc + rename), `:178`, `:184-193` (the new log), `:245-247` (comment), `:254` | the rest is 199 round 1, unchanged |
| `src/main/maestro/drive/uiActGate.ts` (18:33:08) | `:181-188` | card-198 and 199 round 1, unchanged |
| `src/renderer/common/decision/decisionHelper.ts` (untracked, 18:28:40) | `:13`, `:16-20` | — |
| `src/main/maestro/drive/skillScript.ts` (18:29:01) | `:205-207`, `:239` | 199 round 1, unchanged |
| `tests/maestro/decisionHelper.test.mjs` (untracked, 18:38:52) | 17 diff hunks (20 edits): `:9`, `:162`, `:239`, `:290-291`, `:329-361`, `:373`, `:442`, `:451-454`, `:545-551`, `:565-567`, `:666-674`, `:685-687`, `:700`, `:711-714`, `:734-735`, `:761-785`, `:871` | — |

**Task:** [decision-helper-199](../tasks/decision-helper-199.md), `status: in-progress`.

**Contract:** [decision-helper.md](../../features/decision-helper.md) as it reads now (#3 「日志」 and #4's BJ3 / BJ1 / sandbox rows were rewritten at 18:1x). #7 (`decideMany`, qn-004 / qn-006) is out of scope.

**Also:** the naming rules in [decision-maker-naming-and-approval-card.md](../../features/decision-maker-naming-and-approval-card.md) (#2's snapshot row, also new), and BL's `CLAUDE.md` rules.

## Conclusion

**pass.**

- **Blocking: none.**
- **Non-blocking: F1–F4, all P3.**
  - **F1:** a test gap. The sandbox's `check` / `score` can drop a script's options unnoticed (two of my nine mutants survive).
  - **F2:** two comments written in this round contradict each other about where the raw relay text is logged.
  - **F3:** four readability nits for Ral's read.
  - **F4:** two doc sentences are stale (naming doc `:32`; #4's BJ1 「原来」 rule).

**What conforms:**

- **Behaviour unchanged, apart from the log.** 11,828 observations and 12,554 requests were run through `before` and `cur`. There are 0 differences in:
  - request bytes (key order and the method's `type` included);
  - return values (key order, `undefined` / `NaN` / `-0` kept);
  - BJ3 asks or runs, the card and the ERROR;
  - BJ1 notes and texts;
  - sandbox results;
  - renderer and facade traffic;
  - real HTTP bodies.

  The only difference is the new log line: 10,482 of them, each exactly where an independent oracle expects it, and none anywhere else.
- **The log.** The #3 sentence is used verbatim. It is written only for the helper's own `invalid`. The off / unauthenticated / http / network / service-`invalid` lines are unchanged, and the answer never reaches a `message`, card, ERROR, note or text.
- **Renames.** `reportFailure`, `channel` and `decisionBinding` are complete, and nothing was left behind. `DecisionHandler` (class and channel string) is untouched.
- **Cowork.** On the shared surface, 1,927 calls through both helpers are identical in outcome, every log line and the wire bytes.
- **Tests are alive.**
  - My nine new mutants: seven are killed, and two survive (F1).
  - The developer's 14, re-run: all are killed. K3 / K4 / K6 / GU9 still survive against the pre-round test file, so the new assertions are what kill them.
- **Typecheck, tests, lint.**
  - Typecheck: 93 diagnostics before and 93 after, the same set, 0 in this round's files.
  - Tests: 23/23, 31/31, 8/8 and 13/13 on both trees and on the live tree. `skillScopes/execution` is 0/26 on both, with the same 26 names and the same cause.
  - ESLint: no new error or warning.
- **#4 checked against HEAD.** Every BJ3 and BJ1 reply falls in the bucket the new rows name:
  - BJ3: 906 replies, 0 go from asking to running;
  - BJ1: 906 replies, 0 go from the whole snapshot to segmented.

## 1. Contract check (this round's scope)

| Contract | Code | Evidence | Verdict |
|---|---|---|---|
| #3 「日志」: the helper's own `invalid` logs `console.warn('[coach:decision:helper]', 'decision maker gave an unusable answer to "<name>"', JSON.stringify(<answer>))` | `decisionHelper.ts:184-193` | Byte-equal to the contract. The parity oracle expects it on 10,482 asks and it appears on exactly those. Test `:333-345` (27 shapes, one line each) and `:347-360` (verbatim). | ✓ |
| … and nowhere else: usable answers, `low-confidence`, `judge()`, service failures | `:186` guard | Oracle: 0 extra lines. Test `:373` (usable answers, `none` at 0 = low-confidence included). The real-service grid logs the new line only for the four asks that got a bad 200 (§2 item 2). | ✓ |
| #3 「日志」 first sentence: http / network / service `invalid` keep their raw-text line | `reportFailure` `:100-107` | Every non-new log line is identical before and after (e.g. 502: `decision maker relay call failed (http 502): …` + `[coach:decision:helper] ¦ decision maker http 502 ¦ …`) | ✓ (see O1 on 「原文只在这里」) |
| #3 `message` table | unchanged | Parity: every outcome byte-equal; leak check below | ✓ |
| #3 the answer stays out of `message` / card / model | — | Marker answers (`zz-marker-jev`, `jev-secret`) are in the log of 397 observations and in no outcome, BJ3 card, ERROR, BJ1 note or text. Raw `judge()` results are excluded, since #3 hands those back as is. | ✓ |
| #4 BJ3 row (「原来 / 现在」, ① / ②) | gate behaviour unchanged by `answered` | Parity B: 3,870 observations, 0 differences. Bucket check against HEAD: §2 item 7. | ✓ |
| #4 BJ1 row | untouched this round | Bucket check: §2 item 7 | ✓, but one stale clause (F4) |
| #4 sandbox row, including the bare `jev.judge()` / `jev.judge(null)` exception | helper `:245-248` | `sandbox-bare` probe. **HEAD, switch on:** a TypeError (`reading 'timeoutMs'`), nothing sent. **Now:** one POST `{"model":"jev-latest"}`, then `The decision maker could not judge it (http 422).` **Off:** `off` in HEAD, `before` and `cur`. | ✓ |
| #4 `DecisionHandler` | not touched | `decision.handler.ts` unchanged; renderer string `'DecisionHandler'` unchanged; test `:838-839` | ✓ |
| #5 unit tests, guards, typecheck, no E2E | test file | 23/23; the `.mjs` widening reaches both guards (my N7, the developer's GU9) | ✓, F1 |
| Naming #1 / #2 | comments and logs only | The logs are exempt (naming #1); no user-facing text changed | ✓, F4 for the doc |

## 2. The focus checks

| # | What | How | Result |
|---|---|---|---|
| 1 | **Behaviour unchanged** | `parity.probe.mjs`, run on `before` and on `cur`, with one stubbed `jevJudge`. **A** (helper): 6,868 calls. `choose`: 6 thresholds × 774 replies (23 choices × 33 confidences, plus 15 shapes and failures). 126 question × option variants: `type` first / middle / last, no criteria, array criteria, `__proto__` / `constructor` names; `null` / `{}` / model / timeout options. `check`: 19 thresholds × 33 replies. `score`: 3 × 12 × 33. `judge`: 5 request shapes × 7 options × 8 replies. And `enabled`. **B** BJ3, the real gate: 3,870 observations, click + fill + submit; registry Run / Stop / cancel / none; with and without a label and a picture. **C** BJ1, the real segmenter: 774. **D** sandbox: 239 (18 scripts × 13 replies, plus abort after the wait for all five methods). **E**: the renderer module and the facade. **F**: the **real** service with `fetch` mocked (8 HTTP replies × 7 calls; switch off; not signed in). `compare.mjs` compares every field except the logs byte for byte, and requires the log lines left after removing the new line to equal `before`'s. | **0 differences** in 11,828 observations and 12,554 requests. BJ3: 759 asks and 15 runs on Stop, identical in both trees. BJ1: 6 segmented and 768 whole, identical. |
| 2 | **The log** | An independent oracle inside the stub reimplements #3's "usable" rule (choice an own key of `criteria` with a probability in [0, 1]; noul in [0, 1]; score a finite number with a probability) and writes the exact line the helper must log. `compare.mjs` requires the added lines to equal it exactly: count, order and content. | 10,482 new lines in 9,751 observations, **all** as expected. None for `low-confidence`, service failures, `judge()`, off, unauthenticated. **Real service:** the line appears only for the four asks that got a bad 200 (`pick` / `risk` / `ready` / `how`), with the JSON of that answer. None for 502 / 500 / 401 / DNS / no answers / not-JSON. The existing two lines per 502 are unchanged. |
| 3 | **Renames** | `grep -rn` over `src tests scripts docs` | `failureMessage`: only in review 1's text. `decisionMaker` (as a word): none. `reportFailure`: the helper's `:100`, `:178`, `:254` (plus an unrelated local in `fileSearchWindow.service.ts:307`). Renderer: no `handler` left; `channel` at `:13`, `:16-20`. `decisionBinding`: `skillScript.ts:207`, `:239` ×2. The class name `DecisionHandler` and its channel string are unchanged. |
| 4 | **Cowork** | `cross.probe.mjs`: both helpers loaded with the same stub. 1,927 calls: `choose` / `check` / `score` × 14 thresholds (the two `(unprintable)` ones included) × replies, the failures, and `judge` including bare and `null`. Each compared on outcome, every log line, and the wire body plus `timeoutMs`. | **1,927 identical.** See §4 for what differs outside the shared surface. |
| 5 | **Tests are alive** | `mutate.mjs`, nine new mutants (none repeats the developer's 14 or review 1's 56) on `mut`, restored after each | **7 killed:** N1–N7. **2 survive:** N8, N9 (F1). N7 is killed only by this round's `.mjs` widening; it survives with the pre-round test file. The parity probe also flags N2 (60 problems) and N6 (45), so the probe itself is live. |
| 6 | **The developer's 14 mutants** | Their `mutate.mjs`, recovered from their transcript, run on `devmut` | **All 14 are killed** on the round's tests. K3 / K4 / K6 / GU9 survive on the pre-round test file (23/23), as claimed. |
| 7 | **#4 buckets (the rewritten rows)** | `bucket.probe.mjs`: HEAD's gate and segmenter against the current ones, same stub. 25 choices × 36 confidences + 6 answer shapes = 906 replies each. | **BJ3: 0 go from asking to running.** 320 go from running to asking. All of them are ② as written: another string at a confidence JS reads as > 0.5; or `read_only` / `reversible_write` above 1 or at a non-number that does not read as ≤ 0.5 (`[0.9]` included). 547 ask in both with a new reason. All of them are ① as written, and `irreversible` with NaN / Infinity / > 1 / `"0.9"` / `true` / `{}` / `[0.9]` was 「判为不可逆」 before. 39 are unchanged. **BJ1: 0 go from whole to segmented.** 28 go from segmented to whole: exactly 0.7, above 1, and non-numbers that do not read as < 0.7. 37 are unchanged. The other 841 change only the note, exactly the shapes the row lists. The one stale clause is F4. |
| 8 | **Parallel work** | `cmp` of the reviewed files, live against the copies, at 19:13:34; Cowork at 19:14:12 | Unchanged (see Scope) |

## 3. The developer's claims

| Claim | Verified |
|---|---|
| 1. The log in `ask` when `!reading` (`:184-195`); `message` unchanged; test `:290` (27 shapes, one line each), `:347-360` verbatim, `:373` none for usable answers | ✓. The block runs `:184-199`, not `:184-195` (cosmetic). 27 cases counted at `:298-325`. Oracle and mutants N2–N5, L1–L6 back it. |
| 2. `failureMessage` → `reportFailure` (`:92-100`); call sites `:178`, `:254` | ✓ |
| 3. Comments: helper `:245-247`; test `:442`, `:451-454` | ✓. They are accurate against HEAD (`sandbox-bare` probe). |
| 4. Abort loop (from `:761`) gains `check` / `score`; `:711-714` `decision.judge(req, { model: 'x' })`; `:871` `mjs` | ✓. K3 / K4 / K6 / GU9 are now killed. |
| 5. `uiActGate.ts:183-188` named boolean `answered` | ✓. It is equivalent to the old double negation for every `DecisionOutcome`; parity B shows 0 differences; typecheck is clean (the `=== true` narrowing, as in `snapshotSegment.ts:128`). |
| 6. Renderer `:13`, `:16-20` `handler` → `channel` (Cowork's name) | ✓. Cowork `:17` uses `channel`. |
| 7. `skillScript.ts:205-207` → `decisionBinding` plus a line on why; `:239` both references; still no semicolons | ✓ (no `;` added). F3 R-c on the wording. |
| 8. `uiActGate.ts:181-182` comment rewritten | ✓. States the BL fact (two log lines); F2 and F3 R-b. |
| 9. Test `:239` "never above the default 0.5" | ✓ |
| 10. Test comments follow the new #4; "the assertions match #4's buckets"; a list of #4-named inputs that are not pinned | ✓. Every assertion is consistent with #4 and with the bucket probe. Comment wording: F3 R-d. **Worth adding the unpinned inputs?** Not before Ral's review. The bucket probe confirms all of them land where #4 says. In the helper they all take a branch the pinned cases already take: `typeof !== 'number'`, hit by `'0.9'` / `true` / `{}` at `:304`, or the old model's "reads as ≤ 0.5", hit by `-0.2` and a missing value. No plausible regression is caught only by them. Optional: if the test is touched for F1 anyway, `{ choice: 'read_only', confidence: [0.3] }` in ① and `['read_only', [0.9]]` in ② (two lines) pin #4's two array examples, which are the least obvious to a reader. |
| Side changes without new assertions: `:162` now answers `risk`; `:545`, `:666` mock `console.warn` | ✓. `:161` asserts only the request, so the reply change just keeps a stray warn out of the output. |
| decisionHelper 23/23, decisionMakerCard 31/31, uiActWaitHover 8/8, agentDecisionSheet 13/13; `skillScopes/execution` 0/26 before and after, same cause, recorded in an issue | ✓. Both trees give 26 × `Unexpected fixture dependency: @main/decision/decisionHelper` with identical names; `docs/issues/unit-tests-hang-after-fixture-drift.md:37`. |
| typecheck 93 before and after, same set, 0 in the changed files | ✓. `comm` of the sorted lists is empty both ways. |
| K3 / K4 / K6 / GU9 and 10 mutants of items 1 and 5 all killed | ✓ (§2 item 6) |
| 7,254 request cases, 7,437 requests with the same sha256; the same returns; only the item-1 log line is new | Their probe was deleted with their scratch (`rm -rf` at 18:45:04), so it could not be re-run. My own grid gives the same result on a wider set (§2 item 1). |

## 4. Pairing with Cowork

Cowork's helper copy is the 18:41:46 file (`dc5bf6e8`). It has **no** `decide` / `decideMany` at the moment; qn-004's #7 work is not in the working tree. So the whole file is shared surface. Facts only; nothing in Cowork was touched.

| Item | BL | Cowork | Verdict |
|---|---|---|---|
| #3 sentences (message table, low-confidence, threshold note incl. `(unprintable)`) | — | — | identical on 1,927 calls (review 1's `(unprintable)` gap is closed on Cowork's side) |
| The helper's own `invalid` log | `:189-193` | `:163`, the same three arguments | identical |
| `reportFailure` | name, body, the log line | the same | identical |
| `typedQuestion` | the script's `type` deleted, the method's first | the same | identical (the wire bytes too) |
| `shownThreshold` | JSON → `String()` → `(unprintable)` | the same | identical |
| Renderer module | `channel` | `channel` | identical name; BL `() => channel.x(…)`, Cowork `async () => await channel.x(…)` (style) |
| `ask`'s parameters | one object (BL rule) | five positional | each repo's rule |
| Raw relay text in logs | two lines: the service's `logRelayFailure` and the helper's | one line: the helper's (the service logs nothing) | differs (O1) |
| The gate's own log | none | `[coach:decision:ui-act-gate] decision maker unavailable (…)` with the fixed sentence | differs; each allowed by #3 |
| Sandbox binding variable | `decisionBinding` (an `api.fetch` local is called `decision`) | `decision` | naming only |
| Comment on the new log | 「只进日志,`message` 不变」 | 「`message` 仍是固定句式」 | F3 R-a |

## 5. Findings

### Blocking

None.

### Non-blocking

#### F1 — P3 · non-blocking (test hardening) — the sandbox's `check` / `score` can drop the script's options unnoticed

- **Where:** `skillScript.ts:224-235`; the test `#4 the sandbox decision offers choose / check / score …`, `decisionHelper.test.mjs:746-759`.
- **Evidence:**
  - Mutants **N8** (`decisionHelper.check(question, state)` at `:226`) and **N9** (the same for `score` at `:232`) leave the suite at 23/23.
  - Only `choose` is given a threshold through the sandbox (`:749`).
  - #4 says the sandbox's `decision` offers all five methods, 「可传 `{ threshold }`」.
  - This is the same class as review 1's K6, which this round fixed for `judge`.
- **Fix** (test only, two assertions in that test):

  ```js
  reset(answered('ready', { noul: 0.1 }));
  assert.equal((await run("return await decision.check({ name: 'ready', instructions: 'Ready?' }, {}, { threshold: 0.95 })")).result.reason, 'low-confidence');
  reset(answered('how', { score: 1, confidence: 0.9 }));
  assert.equal((await run("return await decision.score({ name: 'how', instructions: 'How?', criteria: ['a', 'b'] }, {}, { threshold: 0.95 })")).result.reason, 'low-confidence');
  ```

  Confidence 0.9 is not above 0.95, so both are `low-confidence`. A dropped options object falls back to 0.5 and decides.

#### F2 — P3 · non-blocking (comment accuracy) — the helper says the raw text goes into "this one log line"; the gate, rewritten in the same round, says two

- **Where:** `decisionHelper.ts:94-95`: 「原文是 relay 透传的报错体或网络报错,里面可能带着 jev 字样或主机名,所以只进这一条日志」.
- **Evidence:**
  - In BL the service writes the raw text too: `logRelayFailure`, `jevDecision.service.ts:65-70`, called at `:128`, `:138` and `:156`.
  - The real-service grid logs both for a 502: `decision maker relay call failed (http 502): jev upstream exploded` and `[coach:decision:helper] ¦ decision maker http 502 ¦ jev upstream exploded`.
  - `uiActGate.ts:181-182`, rewritten in this round, says 「原文只进日志(服务与 helper 各记一条)」.
  - Ral reads both comments in the same review.
- **Fix:** 「……所以只进日志(这一条,和 `jevDecision.service.ts` 的 `logRelayFailure` 那一条),不进 `message`;」.

#### F3 — P3 · non-blocking (readability, for Ral's read)

| # | Where | What | Fix |
|---|---|---|---|
| R-a | `decisionHelper.ts:188` | 「只进日志,`message` 不变」: 「不变」 describes the diff, not the code. Once merged, a reader asks "unchanged from what?". | 「`message` 仍是 #3 的固定句式(`noUsableAnswer`)」 — Cowork's wording (`:161-162`) |
| R-b | `uiActGate.ts:181-182` | One sentence says it twice: 「判不了时只写失败类型和 HTTP 状态:…,卡片和回给模型的 ERROR 只写类型和状态」. And the `answered` explanation 「没过阈值也算答了」 is appended to the naming paragraph. | 「判不了时,卡片和回给模型的 ERROR 只写失败类型和 HTTP 状态(#2,审查 F6):relay 的原始报错体可能带着 jev 字样,原文只进日志(服务与 helper 各记一条)。」 Then 「没过阈值(`low-confidence`)也算答了。」 on its own line directly above `:183`. |
| R-c (optional) | `skillScript.ts:206` | 「上面 `api.fetch` 里已有同名局部变量」 reads like a clash. The `const decision` at `:186` lives in `fetch`'s own scope, so the same outer name would compile and merely be shadowed. | 「…免得和 `api.fetch` 里的局部变量 `decision`(`:186`,接口安全判定)互相遮蔽」. Or drop the line; `decisionBinding` already says what it is. |
| R-d | `decisionHelper.test.mjs:551` | 「`irreversible` with a broken confidence as "classified it as irreversible (X)"」 holds only for confidences JS does not read as ≤ 0.5 (NaN, Infinity, > 1, `"0.9"`, `true`, `{}`). The bucket probe shows `irreversible` with a missing, negative, `null` or `"0.3"` confidence read "not confident enough". The same comment says as much a line earlier for "a missing or negative confidence". #4 itself lists the right set. | 「`irreversible` with a confidence JS does not read as ≤ 0.5 yet outside [0, 1] or not a number (NaN, 1.5, …) as …」 |

**Checked, no finding (readability):**

- **Comments say why:**
  - why the helper logs its own `invalid` and why `JSON.stringify` cannot throw there (`:187-188`: the answers come from `JSON.parse` in `jevJudge`; inherited names such as `constructor` stringify to `undefined`, which is not a throw);
  - the bare `judge()` behaviour against HEAD (`:245-247`);
  - `answered` (`uiActGate.ts:182`);
  - the new test comments at `:442`, `:451-452`, `:565-567`, `:668-674`, `:685-687` and `:734-735` (checked against HEAD).
- **Local style:**
  - semicolons in the helper, the gate and the renderer module; none added to `skillScript.ts`;
  - the `answered` idiom is the same as `snapshotSegment.ts:128`;
  - review ids cited the way the rest of the test file cites them.
- **Lint:**
  - The helper and the renderer module are prettier-clean with 0 ESLint messages in both trees.
  - `uiActGate.ts`: 2 prettier warnings at `:164` and `:201`, outside the hunk, in both trees.
  - `skillScript.ts`: 122 → 122. They come from the file's no-semicolon style, and the positions shift by the two comment lines.
  - The test file: 25 `explicit-function-return-type` errors in both trees (the same kind as its siblings); prettier warnings 122 → 121.
- **No dead code, no new abstraction, no leftover names.** R7, O1, O3, O4 and O5 of review 1 are untouched, as the lead decided.

#### F4 — P3 · non-blocking (doc) — two stale sentences

- **Naming doc `:32`.**
  - **What is stale:** 「快照选段说明同样只写类型和状态…,原文进日志 —— 它会显示在活动记录里」.
  - **What contradicts it:**
    - the updated #2 row at `:28` (「只进 `page_snapshot` 的一条 `info` trace,不回模型、录制不收」);
    - the code: `requestExec.service.ts:365` emits `kind: 'info'`, and `capture.service.ts:751` returns early for `info`, with no broadcast and no record;
    - `snapshotSegment.ts:123-124`.
  - **Fix:** drop 「它会显示在活动记录里」, or say 「它只进一条 info trace(录制与活动记录都不收)」.
- **decision-helper.md #4 BJ1 row (`:92`), 「原来：`confidence < 0.7`(JS 隐式转换)才不采信」.**
  - **What HEAD does:** `(answer?.confidence ?? 0) < 0.7` (HEAD `snapshotSegment.ts:127`), and a choice that is not a block reads 「picked none」 before any confidence is looked at.
  - **The contradiction:** without `?? 0`, a missing confidence (`undefined < 0.7` is false) would read as segmented. That contradicts the same row's 「置信度缺失 … 只有说明变」, which is what HEAD actually did (bucket probe).
  - **Fix:** 「`(confidence ?? 0) < 0.7`(JS 隐式转换)才不采信」, parallel to the BJ3 row's `(confidence ?? 0) <= 0.5`. Optionally add 「choice 不是某一块则 picked none」. The row's three sub-bullets are otherwise exactly right.

### Observations, no finding

- **O1 — #3's 「原文只在这里」.** #3 `:65` says the helper's line is the only place the raw relay text goes.
  - That holds for Cowork, whose service logs nothing.
  - In BL the service's `logRelayFailure` writes it too. Review 1 recorded the two lines as the lead's decision.
  - This round's gate comment now states the BL fact, and F2 would make the helper agree.
  - Whether #3 should get a one-clause BL note is the lead's call.
- **O2 — the log's third argument for a missing answer.** It is `JSON.stringify(undefined)`, i.e. `undefined`, so the line ends `… to "risk" undefined`. That is literally what #3 specifies, Cowork does the same, and test `:341` pins it. Fine as it is.
- **O3 — bookkeeping.** The task is `status: in-progress`, and the feature's `Status:` still says 「交 Ral review 前的小改进行中」. The lead flips both; Ral's code review is next (#5).

### Not verifiable here

- The developer's own byte probe (7,254 cases) and the raw output of their mutant run: their scratch was removed at 18:45:04. Their `mutate.mjs` was recovered from the transcript and re-run (§2 item 6), and my own grid replaces the byte probe.

## Verification (commands actually run)

| Command | Result |
|---|---|
| `cp -p` of the reviewed files → `snap` (18:47); `rsync` of the working tree → `cur` (18:51:31) | `cmp`: `cur`'s five files are identical to `snap` |
| `reverse.mjs`: the developer's 31 `Edit` calls from their transcript, reverse-applied to `snap` → `before`; `anchors.mjs` | Every `new_string` unique; the five anchors in Scope all match |
| `diff -rq -x node_modules before cur` | Exactly the five files differ |
| `node --test --test-timeout=60000 <file>`, one process each (240 s cap), on `before` and `cur` | Both: `decisionHelper` 23/23 · `decisionMakerCard` 31/31 · `uiActWaitHover` 8/8 · `agentDecisionSheet` 13/13 · `skillScopes/execution` 0/26, the same 26 names, 26 × `Unexpected fixture dependency: @main/decision/decisionHelper` |
| The same four task files on the **live** tree (19:15:42) | 23/23 · 31/31 · 8/8 · 13/13 |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck` on `before` (19:00:50–19:02:30) and `cur` (19:02:38–19:04:26); sorted, then `comm` | 93 and 93; nothing only in `before` or only in `cur`; 0 lines in the five files. Other tasks' files (e.g. `piRuntimeAdapter.ts` ×2) are the same copy in both trees. |
| `parity.probe.mjs before` / `cur`, then `compare.mjs` | 11,828 observations and 12,554 requests; **0 problems**; 10,482 new lines, all as the oracle expects; marker only in the logs (397 observations) |
| `bucket.probe.mjs` (`head` against `cur`) | BJ3 906: 0 ask → run, 320 run → ask (②), 547 reason-only (①), 39 unchanged. BJ1 906: 0 whole → segmented, 28 segmented → whole, 841 note-only, 37 unchanged. |
| `sandbox-bare.probe.mjs` (`head`, `before`, `cur`, real service, `fetch` mocked) | Switch on: HEAD gives a TypeError and sends nothing; `before` and `cur` send `{"model":"jev-latest"}` and return `(http 422)`. Switch off: `off` in all three. |
| `cross.probe.mjs` (BL `cur` against the Cowork copy) | 1,927 / 1,927 identical: outcomes, log lines, wire |
| `mutate.mjs`: N1–N9 on `mut`, restored from `cur` after each | N1–N7 killed, N8 / N9 survive; N7 survives on the pre-round test; the parity probe flags N2 (60) and N6 (45); `diff -rq mut cur` identical afterwards |
| The developer's `mutate.mjs` (from the transcript) on `devmut` | 14 / 14 killed on the new tests; K3 / K4 / K6 / GU9 survive on the old ones; both trees restored (`diff -rq` empty) |
| `prettier --check` and `eslint --no-cache -f json` on the five files, both trees | See F3's "Checked" list |
| `grep -rn` for the old and new names over `src tests scripts docs` | See §2 item 3 |
| `cmp` of the reviewed files live against the copies (19:13:34); the Cowork helper (19:14:12); `ps` for leftover `node --test` / `tsc` | Unchanged; unchanged; none |

Not run: E2E, Electron, the app, `yarn build`, and Cowork's suites. Cowork's files were only read and copied. The scratch directory (`rv-dh199-2`) was deleted after this report was written.
