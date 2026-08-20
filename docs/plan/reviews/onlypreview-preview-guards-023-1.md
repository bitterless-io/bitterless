# OnlyPreview Preview Guards 023 — Independent Review 1

Status: **BLOCKED**

Date: 2026-08-20

## Verdict

The byte-admission, identity, revision, and search-index guards are implemented and pass fresh
non-E2E verification. Main and Project Search have exact extension/basename parity, text rejection
is size-first, tolerant UTF-8/BOM UTF-16 reads are bounded at the exact caps, and stale text/asset
authority is fenced through EOF and revocation. The task Path, status, generated-builder note, and
reported 197/197 plus 43/43 evidence are also accurate.

Task 023 is nevertheless not independently deliverable because a valid bounded XLSX/XLSM or DOCX
selection reaches a false `ready` state and renders the generic no-selection empty state. Tasks 020
and 021 remain pending, so these formats must retain the documented truthful unsupported/metadata
surface until their real adapters exist.

## Findings

### P1 · blocking

1. **Valid Office files are reported ready but render as an empty Preview instead of the documented
   unsupported metadata state.**
   - Paths:
     `src/main/onlypreview/onlyPreviewClassifier.service.ts:199-209`,
     `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:57-75,237-249`,
     `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:260-314`,
     `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue:120-155`,
     and `docs/features/onlypreview.md:547-558`.
   - Evidence: the classifier assigns valid `.xlsx`/`.xlsm` descriptors `kind: 'sheet'` and valid
     `.docx` descriptors `kind: 'document'`. Because the downstream adapters are not implemented,
     Region correctly falls back to `adapterId: 'unsupported'` but preserves those descriptor kinds.
     The Vue store has no explicit `unsupported` adapter branch; it falls through, clears loading,
     and calls `reportReady()`. `PreviewSurface` shows the metadata fallback only when
     `descriptor.kind === 'unsupported'`, so `sheet` and `document` fall through to the generic empty
     state. This contradicts the feature contract that Office is unsupported in the current MVP and
     must show name/type/size/modified metadata.
   - Impact: a valid, within-cap Office file is indistinguishable from no selection and Main records
     a successful renderer observation that never occurred. Signature mismatch and oversize errors
     remain truthful, but the accepted Office path is not. This also violates task 023's requirement
     to preserve non-text truth states while tasks 020/021 are still pending.
   - Required correction: give `adapterId: 'unsupported'` an explicit truthful Vue presentation path
     (or normalize the presentation descriptor to the unsupported state) and do not report a real
     adapter ready before it renders. Add focused coverage for valid bounded XLSX/XLSM and DOCX that
     asserts metadata fallback, not `onlypreview__previewEmpty`; tasks 020/021 may later replace that
     fallback with their real adapters.

## Verified guard matrix

| Contract                                                                                                | Independent result                                       |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Main/Search text extensions and 23 exact case-insensitive basenames, including `.markdown`              | PASS — parity test and source comparison                 |
| Size-first zero-body-read rejection, including sparse 1 GiB `.vue` and exact cap + 1                    | PASS                                                     |
| Bounded `limit + 1` tolerant UTF-8/BOM UTF-16 reads, malformed bytes, NUL, and odd UTF-16 tails         | PASS                                                     |
| Main-only `readText` capability with exact runtime token, revision, file ref, and adapter               | PASS                                                     |
| Post-describe, same-handle, current-path, active-identity, and late-result fences                       | PASS                                                     |
| Mandatory finite asset `maxBytes` and selection revision; exact stream length, EOF identity, and revoke | PASS                                                     |
| PDF/image/media/OOXML primitive signatures and 100 MiB/25 MiB/exact-media ceilings                      | PASS, except the valid Office presentation finding above |
| Project Search metadata-only growth/replacement preservation and classifier identity bump               | PASS                                                     |
| Project Search active/candidate preservation; no SQLite `LIKE` or query-time filesystem fallback        | PASS                                                     |
| Markdown original `sourceSize` admission and Monaco scale-only optimization guards                      | PASS                                                     |
| `.markdown` source/Monaco routing plus temporary/generated builder association parity                   | PASS                                                     |
| Task Path ledger, frontmatter status, README row, and delivery evidence                                 | PASS                                                     |

## Independent verification

| Check                                                                                                                                                                        | Result         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `node --test tests/onlypreview/onlyPreviewPreviewGuards.test.mjs tests/onlypreview/onlyPreviewPreviewRegion.test.mjs tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs` | PASS — 32/32   |
| guard + Search boundary/contract/traversal/SQLite audit                                                                                                                      | PASS — 43/43   |
| `node --test tests/onlypreview/*.test.mjs`                                                                                                                                   | PASS — 197/197 |
| `yarn typecheck:node`                                                                                                                                                        | PASS           |
| `yarn check:renderer-i18n`                                                                                                                                                   | PASS           |
| focused ESLint on changed Main/shared/Vue files and focused guard/Region/document/Core/rendering tests                                                                       | PASS           |
| focused Prettier check across task code, tests, docs, and builder source                                                                                                     | PASS           |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`                                                                                   | PASS           |
| `git diff --check` and `electron-builder.tmp.yml` / generated `electron-builder.yml` association parity                                                                      | PASS           |

A broader whole-file ESLint probe over the legacy Search `.mjs` modules still reports their existing
`explicit-function-return-type` baseline and the pre-existing unused `nextTurn` helper; the scoped
task lint above does not claim those legacy modules are globally clean. `yarn typecheck:web` was not
repeated because task evidence already isolates its unrelated repository baseline and this review's
required fresh type gate was `typecheck:node`.

Electron/Playwright E2E, the real application, and packaged smoke testing were not run, per Ral's
instruction.

## Conclusion

**BLOCKED.** Close the valid-Office unsupported-adapter truth-state defect and request a second
independent review. The remaining task-023 guard implementation and evidence are accepted.
