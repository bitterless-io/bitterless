# A widened error payload latches the search relay's protocol failure

Status: fixed; owner verification pending. Delivery:
[task 180](../plan/tasks/onlypreview-search-failure-payload-180.md).

Reported by Ral 2026-09-17 16:30:「搜索报错了，我在某个目录下搜索文件名和内容都不行」, against
**both** bitterless and micromeet-cowork.

## Symptom

Global Search shows `The Project search index returned an invalid response.`
(`onlyPreviewI18n.ts` `INDEX_PROTOCOL_ERROR`). In one directory **both** sections — Files and
Contents — return nothing. The failure does not clear by retrying.

## Evidence

`~/Library/Application Support/Bitterless_DEBUG_PROD/logs/main.log`, build `260917162539`
(packaged 16:25 the same day), times are UTC:

```text
08:30:34.390 main  onlypreview-search  event=xpc-terminal tag=x4 method=search outcome=failure elapsedMs=14716
08:30:34.390 main  onlypreview-search  event=xpc-terminal tag=x3 method=search outcome=failure elapsedMs=14905
08:30:34.390 main  onlypreview-search  event=xpc-terminal tag=x5 method=search outcome=failure elapsedMs=1826
08:30:34.391 page  onlypreview-search  event=search-terminal tag=q6 outcome=cancelled filesCount=0 contentsCount=0 elapsedMs=14897
08:30:34.472 ERROR XpcMainHandler  error in ***/publish [error name=*** errorCode=INDEX_PROTOCOL_ERROR message=OnlyPreview Project search index returned an invalid response.]
```

and the same `***/publish` error again at `08:32:53.854`, `.874`, `.875`, `08:32:54.135`,
`08:33:11.606`. Three in-flight searches die on the same millisecond, which is the signal arm of the
latch, not three independent failures.

The dedicated `<userData>/logs/onlypreview/onlypreview.log` has **no** record of any of it: `publish`
belongs to the relay handler, not to the OnlyPreview Main handler whose `runOperation` writes that
file. Both `***` are the shared log sanitizer replacing a 24-character token run — the redacted
strings are the handler class name and `OnlyPreviewContractError` (exactly 24 characters), so the
only line that survives triage is stripped of the two identifiers triage needs.

## Root cause

A one-sided widening of the error payload across a seam that validates by **exact** key set.

| step | code |
| --- | --- |
| a cancelled or superseded search throws | `single-flight.mjs:1-3` — `Object.assign(new Error('Search cancelled.'), { code: 'CANCELLED' })` |
| the preload search runtime converts any throw | `src/preload/fileSearch/fileSearchRuntime.ts:80-88` — `onlyPreviewFailure(error)` |
| the payload gains a **third** own key | `src/shared/onlypreview/onlyPreview.contract.ts:761-762` — `payload.causeCode = deriveOnlyPreviewCauseCode(error)` → `'CANCELLED'` |
| the search wire rejects it | `src/shared/onlypreview/onlyPreviewSearchFailure.contract.ts:40-45` — `hasExactKeys(value, ['code', 'message'])`, and `hasExactKeys` (`:31-34`) asserts `ownKeys.length === keys.length` |
| the relay latches, permanently | `src/main/fileSearch/fileSearchRuntimeRelay.service.ts` — `_latchProtocolFailure`, rethrown up front by every later `call()` and `publish()`; only `attach()` clears it |

The third key arrived with [task 179](../plan/tasks/onlypreview-error-detail-operation-cause-179.md)
(`03af3696`, 2026-09-17 14:57; mirrored into cowork as `f637974` at 14:57:51). The running build was
packaged at 16:25 and the owner hit it at 16:30. Before 14:57 a cancelled search produced a valid
two-key payload and the relay accepted it.

**Why one particular directory.** Nothing is wrong with that directory's contents. The trigger is
*any* search that gets cancelled or superseded, and only a directory slow enough to keep a query in
flight across the next keystroke reaches that state — 14905ms and 14716ms here against 139ms for a
healthy query on the same workspace.

**Why both sections.** The latch lives on the shared `ActiveRuntime`, not per section, so once it
fires every query fails — every scope, Project included. "Both sections are dead in that directory"
is the latch, not a scope bug. [Task 178](../plan/tasks/onlypreview-files-section-scope-178.md), which
fenced Files with the same scope as Contents the day before, is exonerated: it changes which rows
Files returns, never a key shape.

## Why it survived the tests

`tests/onlypreview/onlyPreviewBackgroundIndex.test.mjs:287` is precisely the test for this — *"failure
events are generation/host fenced and use the same bounded payload validator as RPC errors"* — and it
even asserts that a third key must be rejected (`{ code: 'INDEX_FAILED', message: 'Bad', extra: true }`).

It missed because **every payload in it is a hand-written two-key literal**. The producer is not in
the bundle: the esbuild entry (`:11-16`) exports `FileSearchRuntime`, the relay,
`OnlyPreviewContractError` and `isOnlyPreviewSearchFailureEvent`, but not `onlyPreviewFailure`. The
producer and this consumer have never been in the same test process, so no assertion could compare
them. `onlyPreviewFileSearchRelayProtocol.test.mjs` has no `ok:false` search response at all, and
E2E is structurally blind: `fileSearchRuntime.ts:84-85` rewraps every error as a two-argument
`OnlyPreviewContractError` when `BITTERLESS_E2E=1`, which keeps the payload two keys wide.

Task 179 reasoned about `assert.deepEqual` shapes ("omitted rather than set to `undefined`, so the
old two-key assertions stay green") — true, and exactly blind to a runtime exact-key wire validator.

## Repair contract

- **Admit, then re-constrain.** `isOnlyPreviewSearchErrorPayload` accepts `operation` and `causeCode`
  as optional keys and validates each against `/^[A-Za-z0-9._-]{1,64}$/` — strictly stronger than the
  `message` rule beside it, which only forbids `/` and `\`. The point of this seam is that the
  sender's own sanitizer is not evidence, so admitting a field is not the same as trusting it.
- **Still fail closed on anything else.** Any other own key, a symbol key, or a token that does not
  match still rejects. The existing `extra: true → false` assertion stays as the guard for that; it
  must not be relaxed into "ignore unknown keys".
- **Bind the producer to the consumer in one test process.** The regression is only possible because
  the two live in separate bundles. A test constructs payloads with the real `onlyPreviewFailure` from
  every error shape the search runtime can actually throw and asserts the real validator accepts each
  one. That is what makes the next payload widening fail in CI instead of in the owner's build.
- The producer is not narrowed. `causeCode` on a search failure is diagnostic the owner asked for, on
  exactly the path he was debugging.

Not repaired here, and each left as its own record because none is what he hit:

- **The latch is unrecoverable.** A transient wire mismatch bricks search for the life of the runtime,
  with no operator-visible reason and no path back short of re-attaching. Design ruling for Ral —
  see [onlypreview-protocol-latch-is-unrecoverable](onlypreview-protocol-latch-is-unrecoverable.md).
- **The 14.9s stall** that made the cancel window wide enough to hit. Separate performance issue.
- **Directory-scope gates throw raw `TypeError`** (`search-scope.mjs:28,37`), which this fix turns
  into a clean `ok:false` whose reason is still masked behind `OPERATION_FAILED`.
