---
id: onlypreview-action-diagnostics-103
scope: named OnlyPreview Main operations with a dedicated per-profile onlypreview.log for every action failure
status: implemented; owner verification pending
depends-on: [application-diagnostics-010, onlypreview-search-startup-diagnostics-041]
---

# OnlyPreview Action Diagnostics

## Objective

Make an `OnlyPreview could not complete this action.` report diagnosable. Today the only OnlyPreview
choke point discards the caught error and the operation identity, so the packaged app leaves no
evidence at all.

## Required behavior

1. `resolveOnlyPreviewLogFile(profile, paths)` joins the Translator policy in
   `logPolicy.service.ts`: `<userData>/logs/onlypreview/onlypreview.log` for debug profiles,
   `<libraryDefaultDir>/onlypreview/onlypreview.log` for release profiles. Preview and Stable
   therefore separate through the profile-owned log root already set by `app.setName()`.
2. `src/main/logging/onlyPreviewLog.service.ts` owns a lazily created `logId: 'onlypreview'`
   electron-log instance with the shared formatter, the shared sanitizer hook, 5 MB rotation, and
   console/ipc/remote transports disabled — the same construction the Translator log uses.
3. `src/main/logging/onlyPreviewLogRecord.service.ts` holds the record format and stays free of
   electron-log, so the exact emitted line is directly executable under `node --test`.
4. The service exposes `writeOperationFailure({ operation, code, error })`. It emits one record
   `[onlypreview] operation=<token> errorCode=<token> cause=<sanitized chain>` into the dedicated
   file and mirrors one `error` line into `main.log` through `console.error`. `operation` and
   `errorCode` are reduced to `[A-Za-z0-9._-]` and bounded at 23 characters, because the shared
   sanitizer replaces any run of 24 or more token characters with `***`; the field is `errorCode`
   rather than `code` because `code=<value>` is itself rewritten to `code=***`. The same rewrite is
   applied inside `cause` so an `ENOENT`/`EACCES` class survives. Writing never throws.
5. `runOperation` in `src/main/xpc/onlyPreview.handler.ts` takes the operation name as its first
   argument and reports through the service before returning the generalized payload. Every one of
   the 40 call sites passes its own method name, and all 40 stay unique after the 23-character
   bound. Success paths emit nothing.
6. `applicationDiagnostics.contract.ts` gains the `onlypreviewLogs` directory key,
   `applicationDiagnostics.service.ts` publishes that directory, and both languages label it, so
   `Settings → Log` can open it through the existing allowlist.
7. The failure record carries no path, workspace or host identity, capability token, document
   content, query, or raw error object. `onlypreview-search` timing records and every OnlyPreview
   result payload are unchanged.

## Expected paths

- `docs/INDEX.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/onlypreview-operation-failure-has-no-log.md`
- `docs/plan/README.md`
- `src/shared/diagnostics/applicationDiagnostics.contract.ts`
- `src/main/logging/logPolicy.service.ts`
- `src/main/logging/onlyPreviewLog.service.ts`
- `src/main/logging/onlyPreviewLogRecord.service.ts`
- `src/main/onlypreview/onlyPreviewLog.runtime.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/main/diagnostics/applicationDiagnostics.service.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `scripts/diagnostics/applicationDiagnostics.test.ts`

## Verification

- `yarn test:application-diagnostics` proves: the debug and Preview OnlyPreview log paths; that the
  five runtime profiles produce fifteen distinct files across `main.log`, `translator.log`, and
  `onlypreview.log`, with every Preview file under the Preview root and none under Stable's; that a
  written failure record is valid UTC NDJSON with `scope=onlypreview`, `channel=preview`, and
  readable `operation`/`errorCode`/`cause` fields; that a home path and a query token in the cause
  are redacted; and that a hostile operation/code cannot forge a scope or exceed the bound.
- Source coverage proves every `runOperation` call site in `onlyPreview.handler.ts` is named, that
  there are exactly 40, and that they stay unique after the 23-character bound.
- `yarn typecheck:node` passes.
- Electron E2E is excluded.
