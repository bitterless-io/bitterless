# OnlyPreview Copy-detail block has no operation and no cause

Status: analysis complete; repair contract below; delivery [task 179](../plan/tasks/onlypreview-error-detail-operation-cause-179.md)

## Symptom

Owner (2026-09-17), on both bl and Cowork previews: a Project-rail banner reading "OnlyPreview
could not complete this action." with a Copy-detail button. The copied block is exactly:

```text
OnlyPreview error · 2026-09-17T04:25:48.067Z
code: OPERATION_FAILED
name: OnlyPreviewContractError
message: OnlyPreview could not complete this operation.
```

四行里没有一个字段说得出是哪个操作、哪一类原因 —— "看不出更具体的原因".

## Relationship to the existing "no log" issue

[onlypreview-operation-failure-has-no-log](onlypreview-operation-failure-has-no-log.md) (status:
fixed) covers a **different** gap: it made Main write `<logRoot>/onlypreview/onlypreview.log` with
`operation=` / `errorCode=` / `cause=` so the failure is traceable **on disk, after the fact, by
whoever has the owner's machine**. That fix landed and works (confirmed live on both bl and
Cowork). It never touched the **renderer-visible payload** — the thing the owner actually reads and
copies in the moment. This issue is about that payload.

## Root cause

Read-only investigation (2026-09-17, 5 parallel area reads across bitterless Main/preload/renderer,
the dedicated log, and micromeet-cowork parity — no file was edited). Full chain:

1. Main (or preload) throws something that is not an `OnlyPreviewContractError` — an `ENOENT`, a
   `TypeError`, a rejected SQLite call, one of ~60 well-worded search-engine guards
   ("Search index is not ready", "Browse directory escaped its workspace", …).
2. `toOnlyPreviewErrorPayload` (`src/shared/onlypreview/onlyPreview.contract.ts:703-711`) has a
   two-branch design: an `OnlyPreviewContractError` passes its `code`/`message` through; anything
   else is replaced wholesale by the fixed pair
   `{ code: 'OPERATION_FAILED', message: 'OnlyPreview could not complete this operation.' }`. The
   original error — name, message, errno, stack — is gone at this line, for every one of the ~59
   Main API methods, the 2 alert operations, and every preload catch site (`fileSearch.preload.ts`,
   `fileSearchRuntime.ts`, `fileSearchPreviewRead.handler.ts`, `onlyPreviewBookmarkStorage.handler.ts`
   — none of which even reach Main's logger).
3. `OnlyPreviewErrorPayload` (`src/shared/onlypreview/onlyPreview.types.ts:161-164`) is a closed
   two-field interface (`code`, `message`) — there is no wire slot for operation identity even if
   Main wanted to send it, and an excess property is a `yarn typecheck:node` failure.
4. In the renderer, `unwrapOnlyPreviewResult` (`onlyPreview.contract.ts:720-731`) rebuilds
   `new OnlyPreviewContractError(value.error.code, value.error.message)`. `describeOnlyPreviewErrorDetail`
   (`src/renderer/onlypreview/shell/src/onlyPreviewErrorDetail.service.ts:20-34`) hard-codes
   `stack: ''` for that branch (a plain-Error branch does keep 12 stack lines, but a Main-origin
   failure can never take that branch — it always arrives pre-flattened). `formatOnlyPreviewErrorDetail`
   (same file, :37-47) then prints exactly `code` / `name` / `message` — which is genuinely
   everything the renderer has. **The Copy button is not hiding anything; the payload it receives is
   already at its ceiling.**
5. The operation name (`operation: keyof OnlyPreviewHandler`, known and typed at
   `src/main/xpc/onlyPreview.handler.ts:89`, and already written to `onlypreview.log` at `:96`) is
   discarded at `:97` because the return type has nowhere to put it.

Byte-identical in micromeet-cowork (`apps/cowork/src/shared/onlypreview/onlyPreview.contract.ts`,
`onlyPreview.types.ts`, `.../shell/src/onlyPreviewErrorDetail.service.ts` — verified with `diff -q`),
so the fix is one shared-contract change, mirrored, not two independent ones.

## Why this is not "just forward `error.message`"

`tests/onlypreview/onlyPreviewCore.test.mjs:40-50` already locks the opposite behavior on purpose:

```js
assert.deepEqual(runtime.onlyPreviewFailure(new Error('/private/path leaked')), {
  ok: false,
  error: { code: 'OPERATION_FAILED', message: 'OnlyPreview could not complete this operation.' }
});
```

A raw Node error's `.message` routinely embeds an absolute filesystem path
(`ENOENT: no such file or directory, open '/Users/ral/Documents/.../secret.md'`). Main's own log
sanitizer only rewrites the `/Users/<name>` or `/home/<name>` **prefix** to `~` — the rest of the
path survives in `onlypreview.log` today, which is an accepted risk for a local, owner-only log
file. Reusing that same half-redaction for a field the owner **copies and pastes into chat/a
ticket** would turn an accepted local-log risk into a real distribution one. So `.message` from a
non-contract error must stay out of the wire payload.

## Repair contract

- `OnlyPreviewErrorPayload` and the renderer's `OnlyPreviewErrorDetail` each gain two **optional**
  fields: `operation?: string` (the exact Main API method name, e.g. `selectStandaloneFile`) and
  `causeCode?: string` (a short class-of-failure token).
- `operation` is threaded from `runOperation` / `runAlertOperation` — it is a static string literal
  already present at every call site, never derived from user data. Zero leak surface.
- `causeCode` is derived **only** from the caught error's `.code` (Node errno / SQLite code, e.g.
  `ENOENT`, `EACCES`, `SQLITE_BUSY`) or, failing that, its `.name` when it is not the bare literal
  `'Error'` (e.g. `TypeError`, `RangeError`). **Never** from `.message`. Both `.code` and `.name` are
  fixed, enum-like identifiers on the error object — they cannot carry a path, a token, or any other
  variable content, so this is safe to put on the wire and safe to paste anywhere.
- Both fields are additive and optional everywhere: a contract error (the common, already-correct
  path) is unaffected; a value-less case renders exactly as today (omitted from the Copy block, no
  blank lines).
- Mirrored byte-for-byte into micromeet-cowork's vendored copies of the same three files.

## Explicitly out of scope for this fix (recorded, not implemented)

- **Preload-side `operation` identity.** Every preload catch (`fileSearch.preload.ts` and siblings,
  ~30 sites) calls the same shared `onlyPreviewFailure(error)` with no operation name in hand today.
  Those calls automatically pick up `causeCode` for free (it is derived inside the shared contract
  function), but they will not carry `operation` until each site is threaded individually — a
  larger, mechanical, separately-scoped change.
- **The two Main-side paths that still write no log record at all**:
  `src/main/xpc/onlyPreviewSearchRuntime.handler.ts` (Global Search / browse / office-read — 13
  catch sites, never imports `onlyPreviewLogService`) and
  `src/main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service.ts` (failed preview
  presentations — catches, publishes, does not rethrow, so `runOperation` never sees the failure).
  Both are a distinct, larger change to the Main-log side, not the renderer payload; tracked here as
  a known gap, not a task.
- **micromeet-cowork's `src/shared/diagnostics/diagnostic.service.ts:117`** still emits
  `code=${code}` where bitterless emits `errorCode=${code}` (`:124`) after the 2026-09 fix for the
  credential-key redaction masking `code=` values. Folded into the cowork half of task 179 since
  the same file is touched there anyway; not a prerequisite for the payload widening.
- The pre-existing 800-line budget failure on `onlyPreviewShell.store.ts`
  (`tests/onlypreview/onlyPreviewErrorDetail.test.mjs:92-95`) is untouched by this fix — it fails
  today for an unrelated reason and stays failing.

## Verification

See [task 179](../plan/tasks/onlypreview-error-detail-operation-cause-179.md).
