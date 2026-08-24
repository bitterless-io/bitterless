---
id: onlypreview-design-completion-025
scope: Close the final OnlyPreview design-contract, truthful-metadata, ledger, and source-size gaps
status: implemented; owner verification pending
depends-on:
  - onlypreview-dual-preview-region-024
  - onlypreview-preview-guards-023
  - onlypreview-xlsx-grid-020
  - onlypreview-docx-render-021
  - onlypreview-media-truthful-state-022
  - onlypreview-find-in-file-019
---

# Objective

Close the remaining completion-audit gaps across the implemented OnlyPreview design. Remove absolute
filesystem paths from the Vue Preview descriptor boundary, make every unavailable/error surface
reuse the truthful file-metadata presentation, split every task-modified TS/JS file to the workspace
800-line maximum without weakening coverage, and correct all stale delivery/design ledgers. Preserve
the Shell workspace path and existing Shell file actions, the six delivered Preview capabilities,
and all unrelated owner changes.

# Context

- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
- [OnlyPreview preview format coverage](../../design/onlypreview-format-coverage.md)
- [OnlyPreview feature contract](../../features/onlypreview.md)
- [OnlyPreview delivery analysis](../analysis/onlypreview.md)
- [Current-file find](onlypreview-find-in-file-019.md)
- [XLSX/XLSM grid](onlypreview-xlsx-grid-020.md)
- [DOCX renderer](onlypreview-docx-render-021.md)
- [Image/media truthful states](onlypreview-media-truthful-state-022.md)
- [Preview input guards](onlypreview-preview-guards-023.md)
- [Dual Preview Region](onlypreview-dual-preview-region-024.md)

# Path

- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.less`
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.service.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.type.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlMergeScanner.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewSheetResponseValidator.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheetSession.service.ts` (new)
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewDescriptorBoundary.test.mjs` (new)
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewRenderingAdapters.test.mjs`
- `tests/onlypreview/onlyPreviewRenderingTest.helper.mjs`
- `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewRegionTest.helper.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs` (new)
- `tests/onlypreview/onlyPreviewSearchEngineSqliteTest.helper.mjs` (new)
- `tests/onlypreview/onlyPreviewSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` (new)
- `tests/onlypreview/onlyPreviewSearchShellTest.helper.mjs` (new)
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `tests/onlypreview/specs/onlyPreviewPreview.spec.ts` (new)
- `tests/onlypreview/specs/onlyPreviewActions.spec.ts` (new)
- `tests/onlypreview/specs/onlyPreviewTest.helper.ts` (new)
- `docs/INDEX.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/design/onlypreview-format-coverage.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-find-in-file-019.md`
- `docs/plan/tasks/onlypreview-xlsx-grid-020.md`
- `docs/plan/tasks/onlypreview-docx-render-021.md`
- `docs/plan/tasks/onlypreview-media-truthful-state-022.md`
- `docs/plan/tasks/onlypreview-preview-guards-023.md`
- `docs/plan/tasks/onlypreview-dual-preview-region-024.md`
- `docs/plan/tasks/onlypreview-design-completion-025.md`

Do not modify historical review files. Do not revert or absorb package/version, Omni, Electron pin,
or other unrelated working-tree changes. If a split uses a more precise sibling filename, update this
Path to the exact delivered set before independent review.

# Frontend Design

Unavailable and error states reuse the existing compact metadata surface inside the Vue content
area. They do not add another toolbar, card stack, modal, toast, or `FileActions` instance.

```text
Shell Preview toolbar (unchanged)
┌ file name · relative path · type                         [native actions] ┐
├ Vue content surface ──────────────────────────────────────────────────────┤
│ reason                                                                    │
│ Type        <localized type / extension>                                  │
│ Size        <formatted bytes>                                             │
│ Modified    <localized timestamp>                                         │
└───────────────────────────────────────────────────────────────────────────┘
```

The content surface may repeat the selected file name as metadata but never repeats native action
buttons. Loading, success, partial XLSX, and no-selection layouts retain their existing behavior.

# Delivery

1. Remove `displayPath` from `OnlyPreviewDescriptor`, classifier output, shared parsing, Main
   presentation state, and Vue/public snapshot contracts. Keep `OnlyPreviewWorkspace.displayPath`
   in the Shell workspace contract. Public and runtime-token-bound Vue snapshot tests must reject or
   prove absence of `displayPath` and every canonical/absolute local path.
2. Reuse one metadata view model and one metadata block for direct unsupported, typed unavailable,
   and typed renderer/parser/decoder failures. It displays current file name, localized type or
   extension, formatted size, and modified time while the existing Shell toolbar remains the only
   native-action owner. Cover image decode/read, media source/decode/read, DOCX/XLSX parser, Office
   archive, signature, empty, and size failures through real Store/SFC behavior rather than source
   substring assertions alone.
3. Split every task-modified TS/JS file above 800 lines without deleting, skipping, making exclusive,
   or weakening any test: OOXML preflight, sheet session/validation, Search SQLite tests, Search Shell
   tests, and the OnlyPreview Electron spec source. Preserve exact public exports, Worker/runtime
   behavior, fixture coverage, test discovery, and dynamic-`this` DOM stubs where arrows would change
   semantics. Every resulting TS/JS file must be at most 800 lines.
4. Correct delivery truth: Task 024 Path includes its own task file; Tasks 021/022 describe Task 019
   as already implemented and consuming their ready/none contracts; the format design's dynamic
   import exception covers Preview format services, Workers, and components; the historical index
   progress row names the hidden XPC `fileSearch` renderer rather than UtilityProcess.
5. Update every affected task Path/Evidence plus this task, README, feature, analysis, both designs,
   and docs index as one coherent delivery ledger. Preserve historical reviews unchanged and advance
   Task 025 to owner verification only after an independent PASS.
6. Preserve all existing security, asset, parser, virtual-model, find, media, selected-text, and
   revision/runtime fences. No raw Chrome preload, third renderer, parser in Main/preload, codec,
   transcode path, fallback filesystem scan, or new file action is introduced.

# Acceptance

- No `OnlyPreviewDescriptor`, public presentation snapshot, or Vue presentation snapshot contains
  `displayPath`, a canonical path, or an absolute local path; Shell workspace display remains intact.
- Direct unsupported and every typed unavailable/error state show file name, type/extension, size,
  and modified time. The Shell toolbar remains visible and owns the only FileActions/native actions.
- Image/media/Office/parser errors retain their exact localized reason and metadata; they do not
  render an empty state, broken element, dead player, partial unsafe DOM/model, or duplicate actions.
- OOXML/XLSX runtime behavior and every existing guard/find/search assertion remain equivalent after
  module splits. All changed/new TS/JS files are at most 800 lines and all tests remain discoverable,
  enabled, and assertion-bearing.
- Task/design/feature/analysis/README text agrees that 019–024 remain implemented pending owner
  verification, Task 025's completion audit passed and now awaits owner verification, the hidden
  search runtime is a renderer, and the dynamic-import exception matches actual Preview engine
  locations.
- Package/version, Omni, Electron, and unrelated owner changes remain byte-for-byte preserved outside
  their existing dirty hunks.

# Verification

- Red-first focused descriptor/public-snapshot, presentation metadata SFC/Store, Region, rendering,
  OOXML/XLSX, Search SQLite, Search Shell, and split-source discovery tests
- Focused preview guards, Region, rendering, OOXML, XLSX, and current-file-find tests
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` with unrelated baseline diagnostics reported separately and zero OnlyPreview
  diagnostics required
- `yarn check:renderer-i18n`
- Scoped ESLint and Prettier over every Task-025 TS/JS/Vue/test/doc path
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`
- Build graph audit: only existing OnlyPreview guide/settings/shell/preview entries; ExcelJS and
  `docx-preview` remain isolated behind their existing dynamic format boundaries
- Exact task Path, line-count, test-discovery/no-skip, stale-term, absolute-path, duplicate-actions,
  and cross-ledger audits
- `git diff --check`
- Electron/Playwright E2E, real app, packaged smoke, and ordinary `yarn build`: **do not run**; Ral
  retains final runtime and visual verification.

# Delivery Evidence

- Red-first descriptor/presentation and unified metadata behavior closed at 43/43. The final
  integration-focused descriptor/Region/guards/real Store+SFC pass is 45/45. Public and
  runtime-token-bound Vue snapshot tests inject `displayPath`, `absolutePath`, `canonicalPath`, and
  a nested path-bearing field and prove that none survives the descriptor whitelist; the Shell
  workspace contract and its `displayPath` assertions remain intact.
- One Store-owned `previewMetadata` view model and one `PreviewSurface` block now cover direct
  unsupported, recognized unsupported image/video formats, image/media read/decode/source/empty,
  DOCX/XLSX parse/empty/timeout, Office archive/encryption, signature, codec, and size states. Real
  SFC output verifies file name, type/extension, formatted size, modified time, exact localized
  reason, and the absence of buttons/FileActions. Existing source/behavior coverage proves the Shell
  toolbar remains the sole native Open/Reveal owner.
- The five over-limit sources were split without changing their public contracts or assertions:
  OOXML now has a 742-line facade plus public type/budget and streaming merge-scanner siblings;
  Sheet keeps its compatibility facade and delegates validation/session lifecycle; SQLite Search,
  Search Shell, and the dormant Electron source are split into independently discovered files and
  shared helpers. Split-focused coverage passes 66/66. Across the exact Task-025 Path, the largest
  TS/JS source is Region at 798 lines and every result is at most 800; no skip/only/todo was added.
- `node --test tests/onlypreview/*.test.mjs`: 318/318 passed, zero failed/skipped/todo. Focused OOXML
  is 18/18. `yarn typecheck:node` and renderer i18n pass; `yarn typecheck:web` retains only the
  pre-existing non-OnlyPreview repository baseline and produces zero OnlyPreview diagnostics.
  Scoped ESLint and source/test Prettier pass. Task/design/feature/analysis documents pass Prettier;
  shared `docs/INDEX.md` and `docs/plan/README.md` retain pre-existing unrelated formatting drift,
  while the Task-025 lines themselves match formatter output and were not allowed to reformat those
  unrelated owner hunks.
- The safe runtime-profile Electron Vite source build passes. Output contains the existing four
  visible OnlyPreview entries (`guide`, `settings`, `shell`, `preview`) plus the separate hidden
  `fileSearch` renderer; no third find/toolbar entry or raw Chrome preload exists. `docx-preview`
  remains a dynamic renderer chunk, and only the Sheet Worker references the dynamic ExcelJS chunk.
- Exact 45-path existence/duplicate and local-link audits, descriptor/stale-term/FileActions/task
  ownership checks, line/test-discovery checks, and `git diff --check` pass. Task 024 owns its task
  file; Tasks 021/022 describe 019 as implemented consumption; the dynamic-import exception names
  Preview format service/Worker/component; README names the current hidden XPC `fileSearch`
  renderer. Historical reviews were not edited.
- [Independent review 1](../reviews/onlypreview-design-completion-025-1.md) recorded **PASS**, with no
  P0, P1, or P2 finding. The completion audit is closed at the documented non-E2E implementation
  level, so the ledger advances to `implemented; owner verification pending`. Electron, Playwright,
  E2E, the real application, packaged smoke, and ordinary `yarn build` were intentionally not run;
  the only remaining closure gate is Ral's real-app/runtime/visual checklist.
