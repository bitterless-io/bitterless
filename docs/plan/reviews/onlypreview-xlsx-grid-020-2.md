# OnlyPreview XLSX Grid 020 — Independent Review 2

Status: **BLOCKED**

Date: 2026-08-20

## Verdict

The seven implementation/UI defects from review 1 are closed. The disposable session now reports
unexpected terminal state exactly once under Store fences; single-cell merges fail closed at every
boundary; real ExcelJS 1900/1904 dates retain display/search parity; viewport merge work is bounded;
resize/search reveal is serialized; the alignment contract is truthful; and the mounted grid has
working three-sheet roving focus and coherent ARIA ownership.

Task 020 is still not ready to advance to owner verification because review-1 finding 8 is only
partially closed. The task, plan row, design header, and analysis use the correct
`implemented; independent review pending` state, but the same format design still describes XLSX as
unimplemented/future work. Under the docs-sprint contract, that internal design contradiction is a
blocking P2. No additional implementation P0/P1/P2 was found.

## Finding

### 1. [P2][blocking] The format design still records XLSX as unimplemented future work

- **Current ledger:** task frontmatter, the plan row, the format-design header, and analysis all say
  020 is implemented and awaiting independent review
  (`docs/plan/tasks/onlypreview-xlsx-grid-020.md:1-5`, `docs/plan/README.md:40`,
  `docs/design/onlypreview-format-coverage.md:6-8`, and
  `docs/plan/analysis/onlypreview.md:218-228`).
- **Contradictory design text:** the pending-question closeout still groups `.xlsx` with `.docx` and
  says their engineering state is unimplemented
  (`docs/design/onlypreview-format-coverage.md:353-356`). The engine section still says 020/021 will
  add ExcelJS/docx-preview in the future (`:236-240`), and the delivery closeout still lists 020 as a
  subsequent task whose Worker/preflight gate “must” be implemented (`:374-386`). Those statements
  are current prose, not a labeled historical/rejected record.
- **Impact:** the source-of-truth design simultaneously claims that 020 is implemented and that its
  defining Worker/ExcelJS work has not happened. That fails the review-1 ledger fix and leaves task
  021/future reviewers with an ambiguous predecessor state.
- **Minimum fix:** split the XLSX and DOCX status wherever they are grouped: record 020's ExcelJS
  Worker/dynamic-chunk/preflight delivery as implemented pending review, keep only 021/docx-preview
  as future/unimplemented, and rewrite the closing handoff so the 020 gate is satisfied rather than
  prospective. No implementation or test change is required. Then request review 3 before advancing
  any ledger to owner verification.

## Review-1 Closure Audit

| Review-1 finding                      | Result                         | Fresh evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. post-ready terminal truth          | **closed**                     | `OnlyPreviewSheetSession` has a one-shot unexpected-terminal observer and silent owner/load disposal (`src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts:51-57,670-675,845-872`). Store binds the exact session/generation/selection/reporting revisions before clearing ready/model truth (`src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:353-367,412-440`). Session and Store tests cover idle crash, search timeout, one-shot reporting, normal dispose, load failure, and stale-session silence (`tests/onlypreview/onlyPreviewSheetSessionValidation.test.mjs:374-424`; `tests/onlypreview/onlyPreviewRendering.test.mjs:516-599`). |
| 2. forbidden `A1:A1`                  | **closed**                     | Lexical preflight rejects identical endpoints, model parsing rejects the same form, and the renderer rejects a one-cell merge (`src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.service.ts:530-556`; `src/renderer/onlypreview/preview/src/onlyPreviewSheetModel.service.ts:116-130`; `src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts:404-424`). The exact-count fixture now uses `A1:B1`, with `A1:A1` in the invalid corpus (`tests/onlypreview/onlyPreviewOoxmlPreflight.test.mjs:577-607`).                                                                                                                                           |
| 3. real ExcelJS 1900 dates            | **closed**                     | Date values are converted back to the workbook-epoch serial before number/date formatting, including serial 60 (`src/renderer/onlypreview/preview/src/onlyPreviewSheetFormat.service.ts:168-193,227-247`), and the bounded model/search use that same string (`src/renderer/onlypreview/preview/src/onlyPreviewSheetModel.service.ts:381-401`). Real ExcelJS round trips cover 1900 serials 59/60/61, serial 60.5, 1904, and search parity (`tests/onlypreview/onlyPreviewSheetDate.test.mjs:55-120`).                                                                                                                                                                     |
| 4. viewport merge work bound          | **closed**                     | Validation rejects single/duplicate-master/overlapping merges and caps aggregate viewport intersections before Vue receives them (`src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts:364-476`); exact-bound and hostile-response regressions pass (`tests/onlypreview/onlyPreviewSheetSessionValidation.test.mjs:314-372`).                                                                                                                                                                                                                                                                                                                                 |
| 5. resize/scroll versus search reveal | **closed**                     | One current-sheet coordinator coalesces refreshes and loops to the newest requested version; activation/reveal await that coordinator under sheet/search fences (`src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue:391-499,509-550,636-671`). The mounted V1-pending -> resize -> V2-successor regression proves the final Beta sheet, scroll, target/highlight, and bounded DOM (`tests/onlypreview/onlyPreviewSheetGrid.test.mjs:737-783`).                                                                                                                                                                                                 |
| 6. `fill`/`justify` alignment truth   | **closed**                     | Contract, extractor, and validator now accept only left/center/right (`src/renderer/onlypreview/preview/src/workers/onlyPreviewSheetWorker.contract.ts:63-65`; `src/renderer/onlypreview/preview/src/onlyPreviewSheetFormat.service.ts:262-275`; `src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts:321-345`). Regressions reject the unsupported modes and mount all accepted styles (`tests/onlypreview/onlyPreviewSheetDate.test.mjs:122-131`; `tests/onlypreview/onlyPreviewSheetGrid.test.mjs:653-665`).                                                                                                                                               |
| 7. tabs/grid accessibility            | **closed**                     | Tabs use roving refs and move focus after Left/Right/Home/End; one focused grid owns role, counts, active descendant, key handling, row, and gridcell semantics (`src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue:13-27,84-136,606-634`). The three-sheet mounted sequence and grid ownership assertions pass (`tests/onlypreview/onlyPreviewSheetGrid.test.mjs:667-706`).                                                                                                                                                                                                                                                                   |
| 8. independent-review ledger          | **partially closed; blocking** | Frontmatter/plan/header/analysis and task `# Path` are correct, and Delivery Evidence matches the fresh gates. The contradictory current format-design passages in finding 1 remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Independent Verification

| Check                                                    | Result                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| focused OOXML/date/grid/session/Worker/rendering suite   | PASS — 64/64                                                                                                                                       |
| broader focused 020/core/protocol/region/rendering suite | PASS — 125/125                                                                                                                                     |
| `node --test tests/onlypreview/*.test.mjs`               | PASS — 253/253                                                                                                                                     |
| `yarn typecheck:node`                                    | PASS                                                                                                                                               |
| `yarn typecheck:web`                                     | FAIL — only the pre-existing connector, poker test-global, RigChat, Home, Maestro, Omni, and `pathHelper` baseline; no OnlyPreview/XLSX diagnostic |
| `yarn check:renderer-i18n`                               | PASS                                                                                                                                               |
| scoped ESLint over exact 020 TS/Vue/tests                | PASS — 0 errors; 4 existing shared-rendering-harness warnings                                                                                      |
| scoped Prettier over exact 020 implementation/docs/tests | PASS                                                                                                                                               |
| safe `debug_dev` Electron Vite source build              | PASS — Preview entry 1,508 bytes; Worker 60,354 bytes; ExcelJS 1,446,082 bytes                                                                     |
| built-chunk audit                                        | PASS — only `onlyPreviewSheet.worker-Dpe6nSb7.js` references `exceljs.min-Bo_U2qcd.js`; Preview entry contains no ExcelJS reference                |
| task `# Path` / shared-tree scope                        | PASS — every 020 path is accounted for; concurrent `package.json`, Omni, and other owner changes remain excluded                                   |
| `git diff --check`                                       | PASS                                                                                                                                               |
| Electron/Playwright E2E, real app, packaged smoke        | NOT RUN — explicitly prohibited; Ral owns runtime/visual acceptance                                                                                |

## Conclusion

**BLOCKED.** The implementation findings are closed, but review-1 finding 8 is not fully closed while
the active format design still calls XLSX unimplemented future work. Correct those docs-only current
state passages and run a fresh independent review before owner verification.
