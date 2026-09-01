# OnlyPreview Action Failures Leave No Diagnostic Record

Status: fixed; owner verification pending

## Symptom

OnlyPreview shows:

```text
OnlyPreview could not complete this action.
```

Nothing else is reported. The failing action, the failing subsystem, and the underlying error are
all unavailable, so the report cannot be triaged after the fact.

## Evidence

`~/Library/Logs/Bitterless_PREVIEW/main.log`, 2026-09-01 07:37 — the whole OnlyPreview session
produced exactly one OnlyPreview record, and it is a success line from the search subsystem:

```text
07:37:17 main                     onlypreview-search event=visible-window-terminal tag=v1 outcome=success
07:37:17 renderer:onlypreviewShell onlypreview-search event=shell-initialized tag=h1 outcome=success
```

There is no record of the action that failed. `grep 'renderer:onlypreview' main.log` returns that
single line for the entire run.

## Root cause

`src/main/xpc/onlyPreview.handler.ts` funnels all 40 OnlyPreview API methods through one private
`runOperation` wrapper:

```ts
const runOperation = async <T>(operation: () => Promise<T>): Promise<OnlyPreviewResult<T>> => {
  try {
    return onlyPreviewSuccess(await operation());
  } catch (error) {
    return onlyPreviewFailure(error);
  }
};
```

`onlyPreviewFailure` calls `toOnlyPreviewErrorPayload`, which keeps the code only for an
`OnlyPreviewContractError` and replaces **every other** error — `ENOENT`, `EACCES`, a registry
rejection, a thrown `TypeError` — with the fixed pair
`{ code: 'OPERATION_FAILED', message: 'OnlyPreview could not complete this operation.' }`.

The caught error is never logged. The wrapper also has no operation identity, so even the method
name is discarded. The renderer stores then map an unknown code back to the same generic sentence,
which is what the owner sees.

`onlypreview-search` is instrumented, so the gap is specific: startup and search timing are
observable while every user-triggered OnlyPreview action is not.

## Repair contract

- Every OnlyPreview Main API operation is named, and every failure at that boundary is recorded
  before the payload is generalized.
- OnlyPreview owns a dedicated Main-written log file next to the existing Translator file:
  `<logRoot>/onlypreview/onlypreview.log`, with the same profile isolation, UTC NDJSON format,
  shared sanitizer, and 5 MB rotation as `main.log`. Debug profiles place it under
  `<userData>/logs/onlypreview/`.
- Each failure record carries a fixed short `operation` token, the resolved OnlyPreview
  `errorCode`, and a sanitized `cause` chain (`name` / `errorCode` / `message`) — never a path,
  workspace identity, document content, capability token, or raw error object. The fields are
  bounded at 23 characters and are not named `code`, because the shared sanitizer replaces both a
  24-character token run and any `code=<value>` pair with `***`.
- One matching `error` line is mirrored into `main.log` under scope `onlypreview` so the failure is
  visible where triage starts, with the detail in the dedicated file.
- The Preview channel and the Stable channel write to distinct log roots. That already holds because
  the runtime profile sets `app.setName()` before logging initializes; the repair locks it with a
  test over all five profiles instead of leaving it incidental.
- `Settings → Log` lists the OnlyPreview log directory through the existing allowlisted directory
  contract.
- Diagnostics are best effort: a logging failure must never change an OnlyPreview result. Success
  paths stay silent, and the existing `onlypreview-search` timing records are unchanged.

Delivery: [onlypreview-action-diagnostics-103](../plan/tasks/onlypreview-action-diagnostics-103.md).
