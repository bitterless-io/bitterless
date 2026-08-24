# OnlyPreview Design Completion 025 — Independent Review 1

Status: **PASS**

Date: 2026-08-21

## Verdict

Task 025 satisfies its source-delivery contract. Descriptor/public/Vue presentation boundaries are
relative-only, descriptor validation rejects extra fields, typed unavailable/error states share one
truthful metadata view model and one SFC block, the five oversized source groups retain their public
and test contracts after splitting, and the affected delivery ledgers agree. No P0, P1, or P2
finding was found.

The task remains `implemented; independent review pending` in this review artifact's input, as
required; this review does not advance task or plan status. Electron/Playwright E2E, the real app,
packaged smoke, and the ordinary build were not run. Ral therefore still owns the documented
runtime and visual acceptance.

## Findings

None.

| Severity | Blocking                | Count |
| -------- | ----------------------- | ----: |
| P0       | blocking                |     0 |
| P1       | blocking                |     0 |
| P2       | blocking / non-blocking |     0 |

## Contract audit

| Area                                     | Result   | Independent evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. relative-only descriptor boundary     | **PASS** | `OnlyPreviewWorkspace` alone retains `displayPath` (`src/shared/onlypreview/onlyPreview.types.ts:159-163`); `OnlyPreviewDescriptor` has only relative identity and bounded metadata (`:201-215`). `cloneOnlyPreviewDescriptor()` reconstructs an explicit whitelist and derives the name from `relativePath` (`src/shared/onlypreview/onlyPreview.contract.ts:20-40`). Main clones on presentation install and again for public/Vue snapshots (`src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:270,706-722`). The renderer validator uses required-plus-optional exact keys and rejects forbidden descriptor fields (`src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts:17-28,85-141`; `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs:731-773`). The classifier-injection regression proves `displayPath`, `absolutePath`, `canonicalPath`, a nested path-bearing field, and the canonical string survive in neither public nor runtime-token-bound Vue snapshots (`tests/onlypreview/onlyPreviewDescriptorBoundary.test.mjs:12-37`). Shell still renders `workspace.displayPath`. |
| B. one truthful typed-failure surface    | **PASS** | The Store owns one `OnlyPreviewMetadataViewModel` and one `previewMetadata` derivation (`src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:53-62,104-133`); unavailable, descriptor, renderer/session, and unexpected Sheet terminal failures activate that same path. `PreviewSurface.vue` mounts one metadata block (`src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue:4-46`) and contains no file actions. `FileActions` is mounted only by Shell's `PreviewToolbar` (`src/renderer/onlypreview/shell/src/components/PreviewToolbar/PreviewToolbar.vue:34`). A real Store plus compiled SFC matrix covers direct/recognized unsupported, image read/decode/empty, media read/decode/source/empty, DOCX parse/empty/sanitize/timeout, XLSX parse/empty/timeout, OOXML limit/encrypted/invalid, signature, size, and mapped codec failures; all 23 cases assert exact localized reason, name, type, size, modified time, one metadata block, and no buttons/actions (`tests/onlypreview/onlyPreviewRendering.test.mjs:134-363`).                                         |
| C. source/test splits                    | **PASS** | Every surviving TS/JS/Vue Path entry across tasks 019-025 is at most 800 lines; the two absent 024 entries are explicitly recorded deletions. Task 025 has 31 TS/JS/Vue files, all at most 800 lines; the largest is Region at 798. OOXML is split into a 742-line facade, 70-line public type/budget module, and 370-line merge scanner. Sheet keeps its compatibility facade and delegates to 443-line response validation plus a 500-line session. SQLite Search, Search Shell, and Electron spec sources are independently discovered after splitting. Compared with each tracked pre-split source, SQLite retains 12 tests/79 assertions, Search Shell 21/193, and E2E 22 tests/136 `expect` calls, with zero added skip/only/todo. Async-generator function expressions are syntax-required; the E2E and Sheet DOM stubs retain dynamic `this` (`tests/onlypreview/specs/onlyPreview.spec.ts:312`; `tests/onlypreview/onlyPreviewSheetGridMounted.test.mjs:31`). E2E source discovery was audited through `tests/onlypreview/playwright.config.ts`; E2E itself was not run.                                         |
| D. delivery-ledger truth                 | **PASS** | Task 024 includes its own task path (`docs/plan/tasks/onlypreview-dual-preview-region-024.md:116`). Tasks 021/022 describe implemented task 019 as consuming DOCX ready/media none contracts (`docs/plan/tasks/onlypreview-docx-render-021.md:109,131`; `docs/plan/tasks/onlypreview-media-truthful-state-022.md:20,106`). The format design names the actual Preview service/Worker/component dynamic boundaries, and README names the hidden XPC `fileSearch` renderer (`docs/plan/README.md:11,28,37`). Tasks 019-024 and the plan are `implemented; owner verification pending`; task 025 and the plan are `implemented; independent review pending`. Task 025 has exactly 45 unique existing Path entries. The 13 affected docs contain no missing local link, stale future-019 claim, or contradictory status. Historical reviews were unchanged.                                                                                                                                                                                                                                                                   |
| E. preserved runtime/security boundaries | **PASS** | The descriptor whitelist changes only presentation copies; Main retains real-path identity internally for revalidation. Asset issue/revoke, revision/runtime fences, exact find ownership, OOXML admission, Sheet accepted-model search, DOCX sanitization, media generation fencing, selected-text gating, and task 019 search assertions pass unchanged. The build graph contains only the existing OnlyPreview guide/settings/shell/preview entries plus hidden `fileSearch`; it adds no third find view and no raw Chrome preload. `docx-preview` remains a dynamic client chunk, and ExcelJS remains behind the Sheet Worker boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Code Review report

- Scope: Task 025's exact 31 TS/JS/Vue Path entries on `dev/next`
- Date: 2026-08-21

### File list

|   # | File                                                                                | Lines | Findings |
| --: | ----------------------------------------------------------------------------------- | ----: | -------: |
|   1 | `src/shared/onlypreview/onlyPreview.types.ts`                                       |   361 |        0 |
|   2 | `src/shared/onlypreview/onlyPreview.contract.ts`                                    |   452 |        0 |
|   3 | `src/main/onlypreview/onlyPreviewClassifier.service.ts`                             |   495 |        0 |
|   4 | `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`                    |   798 |        0 |
|   5 | `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts`                |   196 |        0 |
|   6 | `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`                  |   769 |        0 |
|   7 | `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue` |   228 |        0 |
|   8 | `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.service.ts`         |   742 |        0 |
|   9 | `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.type.ts`            |    70 |        0 |
|  10 | `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlMergeScanner.service.ts`      |   370 |        0 |
|  11 | `src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts`                  |     1 |        0 |
|  12 | `src/renderer/onlypreview/preview/src/onlyPreviewSheetResponseValidator.service.ts` |   443 |        0 |
|  13 | `src/renderer/onlypreview/preview/src/onlyPreviewSheetSession.service.ts`           |   500 |        0 |
|  14 | `tests/onlypreview/onlyPreviewCore.test.mjs`                                        |   281 |        0 |
|  15 | `tests/onlypreview/onlyPreviewDescriptorBoundary.test.mjs`                          |    39 |        0 |
|  16 | `tests/onlypreview/onlyPreviewRendering.test.mjs`                                   |   364 |        0 |
|  17 | `tests/onlypreview/onlyPreviewRenderingAdapters.test.mjs`                           |   376 |        0 |
|  18 | `tests/onlypreview/onlyPreviewRenderingTest.helper.mjs`                             |   434 |        0 |
|  19 | `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs`                               |   487 |        0 |
|  20 | `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`                               |   774 |        0 |
|  21 | `tests/onlypreview/onlyPreviewPreviewRegionTest.helper.mjs`                         |   530 |        0 |
|  22 | `tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs`                         |   476 |        0 |
|  23 | `tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs`                     |   333 |        0 |
|  24 | `tests/onlypreview/onlyPreviewSearchEngineSqliteTest.helper.mjs`                    |    42 |        0 |
|  25 | `tests/onlypreview/onlyPreviewSearchShell.test.mjs`                                 |   646 |        0 |
|  26 | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`                               |   564 |        0 |
|  27 | `tests/onlypreview/onlyPreviewSearchShellTest.helper.mjs`                           |   237 |        0 |
|  28 | `tests/onlypreview/specs/onlyPreview.spec.ts`                                       |   725 |        0 |
|  29 | `tests/onlypreview/specs/onlyPreviewPreview.spec.ts`                                |   718 |        0 |
|  30 | `tests/onlypreview/specs/onlyPreviewActions.spec.ts`                                |   156 |        0 |
|  31 | `tests/onlypreview/specs/onlyPreviewTest.helper.ts`                                 |   325 |        0 |

### Problems

None. TS-1 has no violation. The only executable `function` expressions in the reviewed set are two
async generators, which JavaScript cannot express as arrows, and one DOM stub that intentionally
depends on dynamic `this`; they are not TS-2 findings. `PreviewSurface.vue` contains bindings and
derived presentation only, not business orchestration, and does not emit business data, so FE-1 and
FE-2 have no finding. There are no BE-applicable files or BE rules.

## Product-design acceptance

**Implementation: Not closed at full-product evidence level.** The source-delivery review passes,
but the explicitly excluded real-app/runtime/visual evidence remains necessary before claiming the
implemented product is closed.

The acceptance object is the transient selected-file Preview presentation managed by Ral. The entry
is selecting a file in OnlyPreview; the successful terminal state is either a usable truthful
preview or one localized unavailable state that preserves file identity and Shell actions. Ral is
the product owner and final runtime reviewer; Task 025 owns the source-contract closure, and this
independent review owns the non-E2E verification gate.

| Operation | User path                                                                                                          | System behavior                                                                                                                                                         | Evidence                                                                              | Status              |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------- |
| Create    | N/A                                                                                                                | Preview does not create a domain file or persistent presentation; selection creates an ephemeral revision only.                                                         | Task/design lifecycle contract                                                        | **N/A — justified** |
| Read      | Select a file, inspect content or truthful failure metadata, use in-file find where supported.                     | Main classifies and fences a revision; Chrome/Vue renders the admitted format or the unified metadata state.                                                            | Source inspection, real Store/SFC tests, 318-test suite, safe build; real app not run | **Partial**         |
| Update    | Reselect, refresh through watch commit, change find intent, or let a renderer failure demote the current revision. | Revision/generation fences replace or demote the presentation without reviving stale results.                                                                           | Region/find/media/Office tests and source audit; real app not run                     | **Partial**         |
| Delete    | N/A                                                                                                                | The presentation is ephemeral; reselection/workspace clear/teardown revokes its assets, document authority, find state, and views. No user-facing delete is meaningful. | Region lifecycle source and tests                                                     | **N/A — justified** |

### Product-closure gap

- Full-product closure still needs Ral's manual real-app/visual pass. This is blocking only the
  owner-verification/product-closure claim, not this task's source-delivery review; no new code gap
  was found.

### Minimum closure proposal

Ral runs the existing owner-verification checks against representative HTML/PDF, Markdown/text,
image/media, DOCX, and XLSX files, including one typed failure per family and current-file find. If
those checks pass, the delivery owner may advance the ledger; no additional screen, API, or data
lifecycle is indicated by this review.

### Manual acceptance checklist

- Select HTML/PDF and confirm the raw Chromium surface, in-file find, and Shell toolbar coexist.
- Select Markdown/text, DOCX, and XLSX and confirm their Vue renderers and supported find paths.
- Trigger image/media/Office/signature/empty/size failures and confirm reason plus name/type/size/
  modified metadata, with exactly one Shell Open/Reveal action set.
- Switch files during loading/find and confirm no stale content, match, or selected-count survives.
- Confirm no visible content surface receives or exposes an absolute selected-file path.

## Fresh verification

| Check                                                                                      | Result                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| focused descriptor/Region/guards/rendering/OOXML/Sheet/Search suite (19 files)             | **PASS — 145/145**, zero failed/skipped/todo                                                                               |
| `node --test tests/onlypreview/*.test.mjs`                                                 | **PASS — 318/318**, zero failed/cancelled/skipped/todo                                                                     |
| `yarn typecheck:node`                                                                      | **PASS**                                                                                                                   |
| `yarn typecheck:web`                                                                       | **BASELINE ONLY** — exit 2 with 76 existing non-OnlyPreview diagnostics; zero `onlypreview` matches                        |
| `yarn check:renderer-i18n`                                                                 | **PASS**                                                                                                                   |
| scoped ESLint over all 31 Task-025 TS/JS/Vue/test files                                    | **PASS**, zero warnings/errors                                                                                             |
| scoped Prettier over those files plus `PreviewSurface.less`                                | **PASS — 32/32**                                                                                                           |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | **PASS** — Main 1,642, preload 1,039, client 10,428 modules; expected dynamic DOCX and Sheet Worker/ExcelJS chunks emitted |
| build graph/source ownership audit                                                         | **PASS** — existing guide/settings/shell/preview plus hidden `fileSearch`; no third find renderer or raw Chrome preload    |
| split integrity                                                                            | **PASS** — SQLite 12/79, Search Shell 21/193, E2E 22/136 tests/assertions equal their pre-split sources; no skip/only/todo |
| Task-025 Path                                                                              | **PASS** — 45 entries, 45 unique, all exist; no missing affected-doc link                                                  |
| line/stale/path/action/status/diff audits                                                  | **PASS**                                                                                                                   |
| `git diff --check`                                                                         | **PASS**                                                                                                                   |

The safe build emitted two non-Task-025 mixed static/dynamic import warnings in Maestro's ExcelJS
consumer and an EyesOnAgents handler; the build completed and neither warning changes the audited
OnlyPreview dynamic boundaries.

## Weak/manual evidence

- Electron/Playwright E2E, the real app, visual interaction, packaged smoke, and ordinary
  `yarn build` were intentionally not run. The split E2E sources were reviewed for discovery and
  assertion preservation only.
- `yarn typecheck:web` is not globally green because of 76 existing diagnostics outside
  OnlyPreview; the required scoped attribution is clean with zero OnlyPreview diagnostic.
- Runtime/visual quality for Chromium HTML/PDF, DOCX pagination, XLSX layout, actual codecs,
  keyboard focus/IME, selected-count behavior, and final geometry remains Ral's manual gate.

## Conclusion

**PASS.** Task 025 has no P0-P2 finding and is ready for the docs-sprint post-review handoff. This
review does not advance task status; full product closure still waits for Ral's documented
runtime/visual verification.
