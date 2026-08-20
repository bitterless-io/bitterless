# OnlyPreview Preview Guards 023 — Independent Review 2

Status: **PASS**

Date: 2026-08-20

## Verdict

Review 1's P1 truth-state defect is closed. Valid bounded XLSX/XLSM/DOCX selections retain their
`sheet`/`document` descriptors, take the explicit `unsupported` adapter path without a text read,
parser, document token, or asset token, render the metadata fallback instead of the generic empty
state, and report ready only after Vue's render tick and the exact current generation/revision
fence.

The fix is adapter-driven rather than kind-driven, so tasks 020/021 can replace `unsupported` with
their future workbook/document adapter IDs without rewriting or temporarily falsifying descriptor
kinds. No P0, P1, or P2 finding remains.

## Findings

None.

## Review-1 closure evidence

1. **Valid Office metadata fallback — CLOSED.**
   - `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:70-76` derives fallback
     visibility from the current Vue presentation's exact `adapterId: 'unsupported'` plus a real
     descriptor. It does not collapse `sheet` or `document` into `kind: 'unsupported'`.
   - `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:268-288` installs the original
     descriptor, returns from the explicit unsupported branch before `readText`, clears loading,
     awaits `nextTick()`, rechecks the exact local generation and selection revision, and only then
     reports ready. A newer selection invalidates the report.
   - `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue:120-156`
     chooses the metadata surface from `showsUnsupportedMetadata`; the generic empty state remains
     reachable only when no earlier truthful surface applies.
   - Region remains unchanged: `adapterId: 'unsupported'` enters none of its HTML/PDF/image/media
     issuance branches. Valid Office fallback therefore issues no parser/document/asset authority,
     while invalid signature and size states continue to use their existing typed error path.
   - Because fallback depends on the adapter ID rather than `descriptor.kind`, future `xlsx-grid`
     and `docx-dom` adapter IDs will not be captured by the fallback. Tasks 020/021 can add their
     real loader branches atomically while preserving the current `sheet`/`document` types.

2. **Executable renderer regression coverage — CLOSED.**
   - `tests/onlypreview/onlyPreviewRendering.test.mjs` bundles the actual Preview store with narrow
     boundary harnesses and executes the actual `PreviewSurface` SFC template through Vue SSR.
   - XLSX, XLSM, and DOCX each assert the metadata marker and values, absence of
     `onlypreview__previewEmpty`, preserved descriptor kind, zero `readText` and error calls, and one
     revision-exact ready report whose captured state is already non-loading and metadata-visible.
   - Source inspection supplies the ordering proof behind the captured state: `nextTick()` and
     `isCurrent(generation, revision)` both precede `reportReady()`.

## Contract and ledger audit

- Task 023 still lists all four review-fix files in `# Path`: the store, `PreviewSurface`, rendering
  test, and task evidence file. No unrelated dirty path was absorbed into the task ledger.
- Frontmatter and the plan row both remain `implemented; independent review pending`, which is the
  correct pre-review state. The delivery evidence's focused 13/13 and full 199/199 counts are fresh
  and exact.
- Review 1 already accepted the classifier/Search parity, size-first tolerant reads, identity and
  revision fences, finite asset bounds, EOF/revoke behavior, Search metadata-only races,
  Markdown/Monaco guards, `.markdown` association, and generated builder parity. The four-file fix
  does not touch those boundaries, and the fresh full suite keeps them green.
- Concurrent EyesOnAgents/plan work and review 1 were preserved. This review adds only this review-2
  file.

## Independent verification

| Check                                                                                      | Result         |
| ------------------------------------------------------------------------------------------ | -------------- |
| `node --test tests/onlypreview/onlyPreviewRendering.test.mjs`                              | PASS — 13/13   |
| `node --test tests/onlypreview/*.test.mjs`                                                 | PASS — 199/199 |
| `yarn typecheck:node`                                                                      | PASS           |
| `yarn check:renderer-i18n`                                                                 | PASS           |
| focused ESLint on the store, SFC, and renderer test                                        | PASS           |
| focused Prettier check on the exact four-file review fix                                   | PASS           |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | PASS           |
| `git diff --check`                                                                         | PASS           |

The known unrelated `yarn typecheck:web` baseline was not repeated; the exact fix compiles in the
successful renderer source build, and task evidence records no OnlyPreview diagnostic in that
baseline. Electron/Playwright E2E, the real application, and packaged smoke testing were not run,
per Ral's instruction.

## Conclusion

**PASS.** Review 1's sole blocking finding is closed. Task 023 is ready for docs-sprint completion
and Ral's manual runtime verification.
