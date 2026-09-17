---
id: onlypreview-search-failure-payload-180
scope: Let the search wire's failure validator admit and re-constrain the operation/causeCode fields task 179 added, and bind the payload producer to that validator in one test process
status: implemented; owner verification pending
depends-on: [onlypreview-error-detail-operation-cause-179]
verify: node --test tests/onlypreview/onlyPreviewBackgroundIndex.test.mjs tests/onlypreview/onlyPreviewFileSearchRelayProtocol.test.mjs tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs tests/onlypreview/onlyPreviewCore.test.mjs tests/onlypreview/onlyPreviewErrorDetail.test.mjs; yarn typecheck:node; no Electron/Playwright/E2E
---

# One error payload, two validators

## Objective

Task 179 widened `OnlyPreviewErrorPayload` with optional `operation` / `causeCode`. The search wire
has a **second** validator for that same payload which accepts an exact two-key set, so the first
cancelled or superseded search after that change latches `INDEX_PROTOCOL_ERROR` and Global Search
stays dead for the life of the runtime. Root cause, evidence and the "admit, then re-constrain"
ruling are in
[onlypreview-search-failure-payload-latches-protocol-error](../../issues/onlypreview-search-failure-payload-latches-protocol-error.md) —
read it before touching code. This task implements exactly that contract. Nothing else.

## Required behavior

1. `isOnlyPreviewSearchErrorPayload`
   (`src/shared/onlypreview/onlyPreviewSearchFailure.contract.ts:40-45`) admits `operation` and
   `causeCode` as **optional** own keys alongside the required `code` / `message`, and validates each
   present one against `/^[A-Za-z0-9._-]{1,64}$/`.
2. Every other own key still rejects, and so does a symbol key or a non-matching token. The
   `extra: true → false` assertion in `onlyPreviewBackgroundIndex.test.mjs` stays as the guard.
3. `hasExactKeys` is unchanged and still used by `isOnlyPreviewSearchFailure` and
   `isOnlyPreviewSearchFailureEvent` — the envelope layers are not widened.
4. The producer (`toOnlyPreviewErrorPayload` / `onlyPreviewFailure`) is **not** narrowed.
5. `onlyPreviewBackgroundIndex.test.mjs` exports `onlyPreviewFailure` and
   `isOnlyPreviewSearchErrorPayload` from its esbuild entry and asserts the real producer's output is
   accepted by the real validator for every error shape the search runtime can throw: the `CANCELLED`
   single-flight error, a raw `TypeError` from a scope gate, an `ENOENT`-style errno error, a bare
   `Error`, and an `OnlyPreviewContractError`. This is the assertion whose absence let the regression
   ship.
6. Negative coverage for the new tokens: a `causeCode` containing `/` or `\`, one longer than 64
   characters, a non-string one, and an `operation` of `../etc` all reject.
7. Mirrored byte-identically into `micromeet-cowork`
   (`apps/cowork/src/shared/onlypreview/onlyPreviewSearchFailure.contract.ts`), with the mirrored
   assertions added to `apps/cowork/tests/unit/onlyPreviewBackgroundIndex.test.mjs`.

## Path

- `src/shared/onlypreview/onlyPreviewSearchFailure.contract.ts` — the validator
- `tests/onlypreview/onlyPreviewBackgroundIndex.test.mjs` — producer↔consumer binding + negatives
- the same two files mirrored into `micromeet-cowork`
- `docs/issues/onlypreview-search-failure-payload-latches-protocol-error.md`, this task,
  `docs/INDEX.md`, and a cross-reference note on task 179 and its issue

## Out of scope

The unrecoverable latch, the ~15s Contents stall that widened the cancel window, and the raw
`TypeError` thrown by the directory-scope gates. Each is recorded separately; none of them is what
the owner hit.
