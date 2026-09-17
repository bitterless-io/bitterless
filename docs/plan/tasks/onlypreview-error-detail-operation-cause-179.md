---
id: onlypreview-error-detail-operation-cause-179
scope: Widen the OnlyPreview renderer-visible error payload with an optional operation name and a safe cause-class token, mirrored to micromeet-cowork
status: implemented; owner verification pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewCore.test.mjs tests/onlypreview/onlyPreviewErrorDetail.test.mjs tests/onlypreview/onlyPreviewClipboard.test.mjs tests/onlypreview/onlyPreviewRendering.test.mjs; node scripts/diagnostics/run-tests.mjs (or the equivalent yarn test:application-diagnostics); yarn typecheck:node; no Electron/Playwright/E2E
---

# Operation + cause on the OnlyPreview Copy-detail block

## Objective

Owner (2026-09-17): the Copy-detail block behind an OnlyPreview failure toast has only
`code`/`name`/`message`, and for the common case (a non-`OnlyPreviewContractError` thrown in Main or
preload) `message` is always the same fixed sentence — the block cannot say which action failed or
what kind of failure it was. Root cause and the reason a naive `error.message` passthrough is unsafe
are in
[onlypreview-error-detail-lacks-operation-and-cause](../../issues/onlypreview-error-detail-lacks-operation-and-cause.md) —
read it before touching code. This task implements exactly the repair contract in that issue: two
new **optional** fields, `operation` and `causeCode`, threaded through the shared contract and the
two Main `runOperation`-style wrappers, and rendered in the Copy block. Nothing else.

## Required behavior

1. `OnlyPreviewErrorPayload` (`src/shared/onlypreview/onlyPreview.types.ts`) gains two optional
   fields: `operation?: string; causeCode?: string`. `OnlyPreviewResult`/the rest of the union is
   unchanged.
2. `OnlyPreviewContractError` (`src/shared/onlypreview/onlyPreview.contract.ts`) gains two optional
   `readonly` fields carrying the same data, settable via a widened constructor (e.g. a 3rd optional
   parameter `detail?: { operation?: string; causeCode?: string }`, or two more optional
   constructor params — pick whichever keeps every existing
   `new OnlyPreviewContractError(code, message)` call site unchanged, there are dozens across
   preload).
3. `toOnlyPreviewErrorPayload(error: unknown, operation?: string): OnlyPreviewErrorPayload`:
   - `OnlyPreviewContractError` branch: keep `code`/`message` as today, and now also carry through
     the error's own `operation`/`causeCode` if it has any (so a contract error built with the
     widened constructor round-trips), plus accept the new `operation` **parameter** as an override
     when the branch didn't already have one — a contract error thrown deep in a call and rethrown
     through `runOperation` should still learn which Main method it surfaced through.
   - Fallback (non-contract) branch: compute `causeCode` from `error` — a plain object/property read,
     not a class check — as:
     `typeof error?.code === 'string' && error.code ? error.code : (typeof error?.name === 'string' && error.name !== 'Error' ? error.name : undefined)`.
     **Never read `.message`, `.stack`, or any other free-text field of the caught error here.**
     Bound the token to the same safe alphabet/length discipline already established for log tokens
     (`ONLY_PREVIEW_LOG_TOKEN_LIMIT` / `safeToken` in
     `src/main/logging/onlyPreviewLogRecord.service.ts:24-32` — reuse the same constant/shape of
     reasoning, do not invent a second one) so a pathological `error.code`/`error.name` can't inject
     garbage into the payload. Set `operation` from the passed-in parameter when present.
   - Both new fields are omitted (not present as `undefined` keys) when there is nothing to put in
     them, so `assert.deepEqual` against the old two-key shape still passes wherever no
     operation/causeCode is available (see task tests below — this is what keeps
     `onlyPreviewCore.test.mjs:40-50` green without editing it).
4. `onlyPreviewFailure(error: unknown, operation?: string)`: forwards the new parameter to
   `toOnlyPreviewErrorPayload`.
5. `unwrapOnlyPreviewResult`: when rebuilding an `OnlyPreviewContractError` from a failed
   `OnlyPreviewResult`, carry `value.error.operation`/`value.error.causeCode` onto the reconstructed
   error so the renderer can read them back off it.
6. `src/main/xpc/onlyPreview.handler.ts` `runOperation` (:88-99): pass the already-known `operation`
   into `toOnlyPreviewErrorPayload(error, operation)`. No change to the log call at `:96` — Main's
   log already has `operation`, this is only about the wire payload.
7. `src/main/xpc/onlyPreviewAlert.handler.ts` `runAlertOperation` (:19-30): same, passing its
   `operation: 'getAlertSnapshot' | 'resolveAlert'`.
8. `OnlyPreviewErrorDetail` (`src/renderer/onlypreview/shell/src/onlyPreviewErrorDetail.service.ts`)
   gains optional `operation?: string; causeCode?: string`. `describeOnlyPreviewErrorDetail`'s
   `OnlyPreviewContractError` branch reads them off the error (still no `stack`, unchanged).
   `formatOnlyPreviewErrorDetail` appends `operation: <value>` and `cause: <value>` lines, each only
   when present, after `message` and before `stack` (order: code, name, message, operation, cause,
   stack) — match this exact field order in the new test.
9. `onlyPreviewErrorDetail.store.ts`, `App.vue`, `onlyPreviewShell.store.ts`: **no changes.** The
   funnel (`describeOnlyPreviewError` → `onlyPreviewErrorDetail.record`) is untouched; it already
   passes the whole `error` through, so the new fields ride along for free once the class/service
   carry them.
10. `src/main/windows/onlyPreviewHostToggle.service.ts` (`recordFailure`, `operation: 'toggleHost'`):
    leave as-is — it is a Main-log-only call site (`writeOperationFailure`), it does not call
    `toOnlyPreviewErrorPayload` itself and is out of this task's path.
11. Everything above mirrored byte-for-byte into
    `micromeet-cowork/apps/cowork` at the same relative paths, plus fix
    `micromeet-cowork/apps/cowork/src/shared/diagnostics/diagnostic.service.ts:117` — change
    `` `code=${code}` `` to `` `errorCode=${code}` `` to match bitterless's already-shipped fix at
    `src/shared/diagnostics/diagnostic.service.ts:124` (unrelated one-line parity fix, bundled here
    because the file is opened for this task anyway per the paired-development rule — do not expand
    further).

## Path

- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/main/xpc/onlyPreviewAlert.handler.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewErrorDetail.service.ts`
- `tests/onlypreview/onlyPreviewErrorDetail.test.mjs` (new test case)
- `tests/onlypreview/onlyPreviewCore.test.mjs` (verify unaffected; extend if useful, do not weaken
  the existing `/private/path leaked` assertion)
- mirrored into `../../micromeet-cowork/apps/cowork/src/{shared,main/xpc,renderer/onlypreview/shell/src}/...`
- `../../micromeet-cowork/apps/cowork/src/shared/diagnostics/diagnostic.service.ts` (the one-line
  `errorCode=` parity fix)
- `docs/INDEX.md` (this task + the issue doc)

## What the owner gives up

Nothing observable changes for the already-good path (a real `OnlyPreviewContractError` with a
specific code, e.g. `PATH_NOT_FOUND`) — those already show a real message. For the generic
`OPERATION_FAILED` case, the Copy block grows from 3-4 lines to up to 6, and two of those lines
(`operation:`, `cause:`) may be absent when the underlying error carries no `.code`/non-generic
`.name` — that is a real "nothing more to say" case (e.g. a bare `throw new Error('x')`), not a
regression.

## Explicitly not in scope

Everything under "Explicitly out of scope for this fix" in the issue doc: per-call-site `operation`
threading through the ~30 preload catch sites, adding logging to
`onlyPreviewSearchRuntime.handler.ts` / `onlyPreviewPreviewRegion.service.ts`, and any change to
`onlyPreviewShell.store.ts` (its pre-existing 800-line test failure is unrelated and stays red).

## Verification

- `onlyPreviewCore.test.mjs` — the `/private/path leaked` assertion must still pass unchanged
  (`new Error(...)` has no `.code` and `.name === 'Error'`, so `causeCode` is omitted and the
  existing `assert.deepEqual` two-key shape holds). Add a case with `Object.assign(new Error('x'),
  { code: 'ENOENT' })` proving `causeCode: 'ENOENT'` appears and `.message` never does.
- `onlyPreviewErrorDetail.test.mjs` — new test: a reconstructed contract error carrying
  `operation`/`causeCode` renders both lines in the field order above; a contract error without them
  renders exactly as today (no regression on the three existing tests in this file).
- `onlyPreviewClipboard.test.mjs` — must stay green unmodified; this task does not touch
  `OnlyPreviewClipboardService` or its `.cause` (the unrelated, non-enumerable `Error.cause` chaining
  it locks at line 277) at all.
- `onlyPreviewRendering.test.mjs` — must stay green unmodified; `openExternallyError` maps through a
  fixed localized string regardless of payload content, so it is unaffected.
- `scripts/diagnostics/applicationDiagnostics.test.ts` — must stay green unmodified; it only asserts
  handler-source naming/uniqueness, not payload shape.
- `yarn typecheck:node` — the two widened interfaces must not break any existing call site; every
  `new OnlyPreviewContractError(code, message)` call across the repo must keep compiling.
- Same test file list re-run inside `micromeet-cowork/apps/cowork` after the mirror, plus its own
  typecheck.
- Do not run Electron/Playwright/E2E.
