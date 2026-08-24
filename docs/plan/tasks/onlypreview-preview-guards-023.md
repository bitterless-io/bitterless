---
id: onlypreview-preview-guards-023
scope: Enforce size-first bounded preview/index reads while keeping non-text parser signature and archive limits
status: implemented; owner verification pending
depends-on: [onlypreview-dual-preview-region-024]
---

# Objective

Finish the input gates required by the dual Preview Region. Known text extensions and reviewed
extensionless filenames choose the text adapter; size is their only byte-content admission gate.
Files inside the limit use bounded tolerant decoding even when their bytes are ZIP, malformed UTF,
or otherwise produce replacement characters. Unknown extensions remain unsupported. Non-text
formats such as PDF, image, media, XLSX/XLSM, and DOCX retain signature/parser validation and hard
limits before any engine receives bytes.

This task also makes the revision-bound asset limits introduced by task 024 authoritative at open,
stream, and consumer boundaries. A 1GiB `.vue` is rejected from `fstat` without body reads, Monaco,
or parser creation; the same file still appears in the directory and filename search.

# Context

- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md) — #1, #6, #8, and
  especially #8.1
- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
  — #7.4 capability state and text-instance examples
- [Dual Preview Region](onlypreview-dual-preview-region-024.md)
- [OnlyPreview sub-application](../../features/onlypreview.md)

# Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/main/onlypreview/onlyPreviewAsset.registry.ts`
- `src/main/onlypreview/onlyPreviewDocument.registry.ts`
- `src/main/onlypreview/onlyPreviewProtocol.service.ts`
- `src/main/onlypreview/onlyPreviewWorkspace.registry.ts`
- `src/main/onlypreview/onlyPreviewIndex.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/main/fileSearch/fileSearchRuntimeRelay.service.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/preload/onlypreview/search/core/classification.mjs`
- `src/preload/onlypreview/search/core/constants.mjs` (verification-only; existing 1MiB constant retained)
- `src/preload/onlypreview/search/core/browse-index.mjs` (verification-only; no 023 diff expected)
- `src/preload/onlypreview/search/core/sqlite-index.mjs`
- `src/preload/onlypreview/search/core/traversal.mjs`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service.ts`
- `src/renderer/onlypreview/preview/src/components/MonacoTextPreview/`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewSearchSnapshot.service.ts`
- `electron-builder.tmp.yml`
- `electron-builder.yml` (generated verification artifact; no committed diff expected)
- `tests/onlypreview/runtime.entry.ts` (verification-only; existing exports retained)
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs` (new)
- `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs` (verification-only)
- `tests/onlypreview/onlyPreviewSearchEngine.contract.test.mjs` (verification-only)
- `tests/onlypreview/onlyPreviewSearchEngine.traversal.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs` (Task 025 split)
- `tests/onlypreview/onlyPreviewSearchEngineSqliteTest.helper.mjs` (Task 025 split)
- `docs/design/onlypreview-format-coverage.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-preview-guards-023.md`

Do not modify unrelated owner changes. Preserve task 024's no-preload Chrome boundary and existing
Project Search active/candidate SQLite architecture.

# Delivery

1. Route known text extensions and this exact case-insensitive basename set directly to the text
   adapter: `Dockerfile`, `Containerfile`, `Makefile`, `Rakefile`, `Gemfile`, `Procfile`, `README`,
   `LICENSE`, `NOTICE`, `CHANGELOG`, `AUTHORS`, `CODEOWNERS`, `.gitignore`, `.gitattributes`,
   `.gitmodules`, `.dockerignore`, `.editorconfig`, `.npmrc`, `.yarnrc`, `.prettierrc`, `.eslintrc`,
   `.stylelintrc`, and `.babelrc`. Main and fileSearch may share one portable constant or maintain
   exact parity under a test. Delete the unknown-extension 8KiB text promotion and text-candidate
   NUL/control/encoding rejection. Every other unknown extension/basename defaults to unsupported
   unless a future explicit "open as text" contract is added.
2. Before any text body read, use the already authorized open file handle's `fstat`: regular file
   only; Monaco/plain text ≤8MiB; Markdown and HTML ≤1MiB. If over limit, return the typed limit state
   with zero body bytes read and no model, sanitizer, Chrome navigation, or dynamic import.
3. Perform actual text reads as bounded `limit + 1` streams/chunks. Decode tolerantly, allowing
   replacement characters. A stat/read growth race beyond the cap aborts and discards the revision;
   never truncate and describe the result as complete.
4. Keep `.js`, `.vue`, `.css`, and all Monaco-routed source inert. A ZIP renamed `.js` may display
   garbage but cannot execute, widen privileges, fail the Preview host/index generation, trigger a
   modal/retry loop, or contaminate another file's state.
5. Apply the same extension + size + tolerant-decode rule to Project Search content eligibility with
   its 1MiB body cap. Above the cap and for sensitive files, keep metadata/filename search only. Do
   not add SQLite `LIKE`, per-query filesystem fallback, or whole-file synchronous reads.
6. Preserve non-text signature checks and parser-specific truth states. PDF, image, audio/video, and
   OOXML are not admitted merely because they are under their byte cap. PDF remains all-or-nothing
   Chromium navigation with a 100MiB hard cap: no Vue/pdf.js page-cap or partial-page implementation.
   Image assets have a 100MiB admission cap. XLSX/XLSM/DOCX use their downstream 25MiB parser cap.
   Audio/video stay range-streamed without a global product-size rejection; their finite growth
   ceiling is the verified selection-time file size.
7. Centralize adapter limits and require every asset capability to carry a finite `maxBytes` bound to
   host + the non-reused `workspaceId` workspace-generation identity + selection revision +
   canonical path and verified file identity.
   For capped/buffered formats use `min(verifiedSize, formatCap)`; for streaming audio/video use the
   exact verified size. A Range/response stream delivers no probe byte beyond its declared bounded
   response; its bounded transform plus EOF `fstat` and current-path identity/size/mtime revalidation
   rejects growth or replacement. Only bounded text reads use a `limit + 1` probe. Active streams
   abort on revision revocation.
8. Add Monaco large-file protections driven only by scale (large-file optimization, bounded
   tokenization and pathological single-line work). They must not reintroduce content sniffing.
9. Update the feature/analysis/plan contracts and remove claims that strict UTF decode,
   `BINARY_TEXT`, `INVALID_ENCODING`, or 8KiB head sniff are current acceptance.

# Acceptance

- A 512KiB ZIP renamed `.js` opens in Monaco with bounded tolerant text and does not disturb another
  preview or the Project Search active index; the same bytes named `.zip` remain unsupported.
- Exact 1MiB/8MiB boundaries are accepted by their configured adapter; limit+1 is rejected. A sparse
  1GiB `.vue` causes zero body reads, no Monaco model, and no Project Search body row.
- Unknown extensions no longer become text from an 8KiB sample. Text extensions no longer fail
  because of NUL/control-heavy bytes or invalid UTF sequences.
- Stat-after-open and read-growth races cannot deliver bytes beyond the limit or install a stale
  revision.
- PDF/image/media/OOXML mismatches still fail before their engine; non-text parser gates are not
  weakened by the tolerant text decision.
- PDF/image exact 100MiB is accepted and limit+1 is rejected; audio/video Range remains available for
  a larger stable file but aborts if it grows or its identity/revision changes.
- Oversized or sensitive text remains visible in the tree and filename search, while current-file
  find is unavailable and Project Search body indexing is skipped.
- No oversized input uses `readFile()` before checking size; no fallback query scans full files.

# Verification

- Focused guard/classifier/search boundary tests, including sparse/growing fixtures
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` (separate unrelated baseline failures)
- `yarn check:renderer-i18n`
- Focused ESLint for changed OnlyPreview files
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`
- `git diff --check`
- Electron/Playwright E2E: **do not run**; Ral performs final runtime verification.

# Delivery Evidence

- Main and Project Search now share an exhaustively tested extension/exact-basename policy, perform
  size-first zero-read rejection, and decode admitted UTF-8/BOM UTF-16 tolerantly. Search growth or
  replacement produces a metadata-only row instead of dropping the filename/tree entry.
- Region exclusively issues revision-bound text, asset, and document authority after an exact
  opened-file revalidation. Late text bodies, stale revisions, same-handle growth, current-path
  replacement, stream revoke, and EOF identity changes are rejected.
- PDF/image 100MiB, Office 25MiB primitive signature, Markdown/HTML 1MiB, Monaco 8MiB, and Search
  body 1MiB boundaries are centralized and covered at exact cap and limit+1. Large stable media
  retains exact-size Range delivery without a product cap.
- Review-fix verification executes the real Preview store bundle and the `PreviewSurface` SFC:
  bounded XLSX/XLSM/DOCX keep their `sheet`/`document` descriptors, issue no text read or parser
  asset, render the adapter-driven unsupported metadata state, and only then report the fallback
  ready. The focused renderer suite passed **13/13**.
- Full OnlyPreview Node suite: **199/199 passed**. The independent Search-focused audit passed
  **43/43**. `yarn typecheck:node`, renderer i18n, scoped formatting/lint, the non-mutating Electron
  Vite source build, and `git diff --check` passed.
- Task 025 removes absolute selected-file paths from the descriptor/public/Vue boundary and splits
  the SQLite regression source into independently discoverable index/engine/helper files without
  changing its 12 tests or guard coverage. The final combined OnlyPreview suite passes 318/318 with
  zero skip/only/todo, and every resulting TS/JS file is at most 800 lines.
- The optional strict Node TypeScript pass exhausted the default V8 heap near 4GiB before emitting a
  diagnostic. `yarn typecheck:web` retains only the unrelated Connector/Poker/Home/Maestro/Omni/path
  baseline errors and reports no OnlyPreview diagnostic.
- Electron/Playwright E2E and the real application were not run. Ral retains final runtime
  verification. Independent review 2 passed with no P0/P1/P2 findings after the Office metadata
  fallback correction; see
  [onlypreview-preview-guards-023-2](../reviews/onlypreview-preview-guards-023-2.md).
