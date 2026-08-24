---
id: onlypreview-find-in-file-019
scope: Add one Shell-owned current-file Find Bar routed by Main to native WebContents or Vue model adapters
status: implemented; owner verification pending
depends-on: [onlypreview-media-truthful-state-022]
---

# Objective

Add Chrome-like current-file find without injecting UI or scripts into previewed content. A single
Find Bar lives in the fixed Shell Preview toolbar. Main is the sole owner of selection and find
revisions and routes each accepted intent to the active renderer capability:

- `webContents.findInPage()` for raw HTML, Chromium PDF, Markdown DOM, and sanitized DOCX DOM;
- a revision-fenced Vue content adapter for Monaco's complete model and the XLSX Worker model;
- unavailable for image, audio, video, unsupported, oversize, loading failure, or parse failure.

Project Search (`Cmd/Ctrl+Shift+F`) remains a separate Shell feature and protocol.

# Context

- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
  — #7.1, #7.2, #7.4, and #7.5 are the authoritative contract
- [Dual Preview Region](onlypreview-dual-preview-region-024.md)
- [XLSX grid](onlypreview-xlsx-grid-020.md)
- [DOCX render](onlypreview-docx-render-021.md)
- [Media states](onlypreview-media-truthful-state-022.md)
- [OnlyPreview sub-application](../../features/onlypreview.md)

# Path

- `src/main/onlypreview/views/onlyPreviewFind.service.ts` (new)
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts` (new)
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/shared/onlypreview/onlyPreviewFind.registry.ts` (new)
- `src/renderer/onlypreview/shell/src/components/PreviewToolbar/`
- `src/renderer/onlypreview/shell/src/components/FindBar/` (new)
- `src/renderer/onlypreview/shell/src/onlyPreviewFind.store.ts` (new)
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewFindAdapter.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewMonacoFind.service.ts` (new)
- `src/renderer/onlypreview/preview/src/components/MonacoTextPreview/`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/SheetPreview/`
- `src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.store.ts` (new)
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts`
- `tests/onlypreview/onlyPreviewFind.test.mjs` (new)
- `tests/onlypreview/onlyPreviewFindRenderer.test.mjs` (new)
- `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewRegionTest.helper.mjs` (new)
- `tests/onlypreview/onlyPreviewPreviewView.test.mjs` (new)
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewCoreTest.helper.mjs` (new)
- `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs` (new)
- `tests/onlypreview/onlyPreviewAppWiring.test.mjs` (new)
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` (new)
- `tests/onlypreview/onlyPreviewAdapterSource.test.mjs` (new)
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewRenderingTest.helper.mjs` (new)
- `tests/onlypreview/onlyPreviewRenderingAdapters.test.mjs` (new)
- `tests/onlypreview/onlyPreviewCharacterCount.test.mjs` (new)
- `tests/onlypreview/onlyPreviewSheetGrid.test.mjs`
- `tests/onlypreview/onlyPreviewSheetGridTest.helper.mjs` (new)
- `tests/onlypreview/onlyPreviewSheetGridMounted.test.mjs` (new)
- `tests/onlypreview/onlyPreviewSheetController.test.mjs` (new)
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

Do not add a third toolbar renderer, a raw-page preload, DOM injection, regex, whole-word mode, or a
second search input. Preserve unrelated owner changes and Project Search behavior.

# Frontend Design

The Find Bar occupies the right segment of the existing 43px Preview toolbar: compact input,
case-sensitive toggle, previous/next, `n/m` (plus a localized partial marker when applicable), and
close. File path truncates first; the toolbar never grows. Pending keeps the input and close action
available so one query can queue, disables case/navigation, and never shows false `0/0`; unavailable
gives one quiet inline feedback. Highlight color uses the existing Royal Blue family, with a stronger
active match. No modal, floating BrowserWindow, or extra card.

# Delivery

1. Add an exhaustive TypeScript adapter registry mapping every preview adapter to surface and
   `webcontents-find | content-adapter | none`. A newly added adapter without a find decision must
   fail typecheck. Static registry describes expected capability; runtime remains
   `pending → ready | unavailable(reason)` for the exact host + selection revision + surface.
2. Intercept `Cmd/Ctrl+F` in Main for Shell, Chrome, and Vue content WebContents, ignoring repeat and
   explicitly excluding `Cmd/Ctrl+Shift+F`. For a ready capability, focus Shell then its Find input;
   pending may open with an enabled input and queue the current query while case/navigation remain
   disabled; unavailable does not open and emits quiet localized feedback. Closing restores focus
   to the current active content view.
3. Shell submits only query/case/navigation/clear intent through its host capability. Main resolves
   current host/selection/surface, increments the only accepted `findRevision` for each query,
   case-mode change, next/previous, or clear, and immediately broadcasts accepted state. Shell and
   content renderers never mint revisions or receive a `webContentsId`.
4. Route Chrome HTML/PDF and Vue Markdown/DOCX to `webContents.findInPage()`. Initial/new query uses
   `findNext: true`; next/previous uses the same query with `findNext: false`, correct direction, and
   current case mode. Empty/close/surface change calls `stopFindInPage('clearSelection')`.
5. Fence native results by exact host + selection revision + surface + find revision **and** internal
   WebContents identity/generation + Electron requestId. A numeric requestId alone is insufficient
   because views are destroyed/recreated. Accept only current `found-in-page` results; never expose
   WebContents identity to a renderer.
6. Implement the Vue adapter bridge with exact runtime capability/revision validation. Monaco scans
   the complete accepted model for literal match count without materializing all ranges, advances
   navigation through Monaco's original-model next/previous match ranges, and creates at most one
   active decoration before `revealRangeInCenter`; it never maps offsets from a length-changing
   case-folded string onto the source and never opens Monaco's second find widget.
   XLSX delegates to its Worker-owned accepted model, switches sheets, reveals, and highlights the
   active cell. Both return current/total/coverage.
7. Normalize the result envelope to host + selection revision + surface + find revision,
   `activeMatchOrdinal`, `matches`, `finalUpdate`, and `coverage`. Native, Monaco, Markdown, PDF, and
   DOCX report complete coverage. XLSX alone may report `partial` with `sheet-model-cap`,
   `acceptedSheets`, and `acceptedCells` after successful hard gates; Shell must display that it is
   partial.
8. `Esc`/close clears query, native selection/adapter decoration, active count, queued pending query,
   and result revision. File/surface/workspace change, reload, renderer crash, or host revoke performs
   the same clear before new capability readiness; stale events cannot reopen the bar or overwrite
   new results.
9. Case-sensitive matching is MVP. Regex and whole-word are absent. HTML scripts may change DOM;
   explicit next/previous or resubmitting the same query re-runs native find. Canvas/WebGL pixels and
   scanned PDFs without text layers truthfully yield zero matches; OCR is out of scope.
10. Keep selected-text grapheme counts independent of find highlights. Chrome still has no preload;
    native highlight requires no content injection. Add symmetric en/zh copy and update the feature,
    analysis, and plan contracts.

# Acceptance

- `Cmd/Ctrl+F` from Shell, Chrome HTML/PDF, or Vue content focuses the one Shell Find Bar for every
  ready capability without shadowing Project Search.
- HTML/PDF/Markdown/DOCX use Chromium highlight/scroll/count through `findInPage()`; toolbar text is
  not counted because it belongs to Shell. Monaco/XLSX find all accepted model data outside the
  virtual viewport and reveal the target with app-owned highlights.
- Case toggle and previous/next update the exact current result. Rapid `a → ab`, file/surface switch,
  Chrome recreation, and late native/adapter results cannot install stale counts/highlights.
- Image/audio/video/unsupported/error do not open a fake search session. Loading may show pending but
  never `0/0`; XLSX model truncation is visibly partial with accepted coverage.
- Close/Esc/workspace/reload/crash clears native and adapter highlights and restores active-content
  focus. Selected-character metadata remains correct and is not inflated by highlights.
- No raw HTML preload/script injection, third renderer/window, `<mark>` mutation, regex, whole-word,
  or cross-WebContents aggregate search is introduced.

# Verification

- Focused native request mapping, stale fencing, capability-state, Shell store, Monaco adapter, and
  XLSX adapter tests
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` (separate unrelated baseline failures)
- `yarn check:renderer-i18n`
- Focused ESLint for changed OnlyPreview files
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`
- `git diff --check`
- Electron/Playwright E2E: **do not run**; Ral performs final find/highlight/focus verification.

# Delivery Evidence

- Review-fix focused registry/parser, Main/native/content routing, Region/View lifecycle, Shell
  race/IME, UI source, Sheet controller, and model-adapter regression: 64/64 passed. Negative
  coverage includes pending-to-ready dispatch once, wrong/missing adapter, stale same-WebContents
  generation, requestId/selection/find-revision mismatch, changed navigation intent, native
  destroy/throw, unsupported reason, runtime result fencing, rapid `a → ab` snapshot reversal, and a
  Main snapshot arriving during IME composition. Composition state now lives in the Store; the final
  composition value is submitted exactly once.
- Monaco counts all 8,388,608 literal matches in an accepted 8MiB dense model, advances navigation
  through original-model ranges, creates at most one decoration, and never mutates editor selection.
  The Unicode expansion regression `İx` / `x` proves the active range remains at the original model's
  column 2 rather than a folded-string offset.
- The raw-Chromium view/session/navigation lifecycle moved to
  `onlyPreviewPreviewView.service.ts`; Region retains selection, presentation, capability, and find
  revision authority. Region is 797 lines and its sibling is 548. `SheetPreview.vue` is 519 lines and
  delegates async sheet/search workflow to its 411-line reactive controller. Every scoped TS/JS/Vue
  file is at most 800 lines; the largest scoped test is 764 lines.
- Full `node --test tests/onlypreview/*.test.mjs`: 315/315 passed.
- `yarn typecheck:node` and `yarn check:renderer-i18n`: passed. `yarn typecheck:web` retains only the
  existing non-OnlyPreview Connector, Poker, Home, Maestro, Omni, and shared-path baseline; it
  produced no OnlyPreview diagnostic.
- Focused ESLint and Prettier for the exact Task 019 source/test/doc set: passed.
- Safe source build passed through
  `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` in
  22.3 seconds. Output audit found only the existing `onlypreview/guide`,
  `onlypreview/settings`, `onlypreview/shell`, and `onlypreview/preview` entries; DOCX stays a dynamic
  `docx-preview` chunk, XLSX parsing stays in `onlyPreviewSheet.worker` with dynamic ExcelJS, and no
  third renderer/search entry or raw-content preload was added.
- `git diff --check`: passed. Electron/Playwright E2E and the real app were intentionally not run;
  Ral retains final HTML/PDF/Markdown/DOCX native highlight, Monaco/XLSX navigation, narrow-pane,
  selected-character, clear, and focus-restoration verification.
- Task 025's completion pass keeps the public and runtime-bound Vue presentation snapshots
  relative-only, routes every typed Preview failure through one metadata surface, and preserves the
  exact find registry, ready handshake, revision fences, and 019 assertions. The combined
  OnlyPreview suite now passes 318/318 with zero skipped, exclusive, or todo tests; every changed or
  split TS/JS file remains at most 800 lines.
- [Independent review round 1](../reviews/onlypreview-find-in-file-019-1.md) recorded **BLOCKED** on
  the IME snapshot race, Monaco Unicode range mapping, and seven scoped code-review findings. The
  review-fix evidence above preserves the closure of every finding.
- [Independent review round 2](../reviews/onlypreview-find-in-file-019-2.md) recorded **PASS**, with
  no P0, P1, P2, docs-sprint blocker, stub, mock, or fake integration path remaining.
- The ledger is `implemented; owner verification pending`; the remaining gate is Ral's real-app
  runtime and visual verification below.

# Owner Verification

- [ ] Open representative HTML, PDF, Markdown, and DOCX files; verify native highlight, scrolling,
      active/total count, and next/previous navigation.
- [ ] In Monaco, verify case-sensitive and case-insensitive search, next/previous wrapping, and a
      Unicode case-fold example such as `İx` / `x` highlights the original `x`.
- [ ] In XLSX/XLSM, verify next/previous can cross sheets, reveals the active cell, and a bounded
      workbook displays truthful partial coverage.
- [ ] Verify the one Find Bar remains usable in a narrow Preview pane and Chinese IME composition
      keeps the live draft without submitting intermediate text.
- [ ] Verify `Cmd/Ctrl+F` opens current-file find while `Cmd/Ctrl+Shift+F` continues to open Project
      Search.
- [ ] Verify `Esc` and the close button clear highlights/results and restore focus to the active
      Preview content.
- [ ] Verify selected-character metadata remains independent from native and Monaco find
      highlights.
- [ ] Verify image and audio/video previews report current-file find as unavailable and never show a
      fake `0/0` result.
