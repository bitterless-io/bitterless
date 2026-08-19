---
id: onlypreview-find-in-file-019
scope: Cmd+F find bar inside the merged Preview header with per-type find adapters and non-destructive highlighting
status: pending
depends-on: [onlypreview-preview-header-merge-018]
after: [onlypreview-xlsx-grid-020, onlypreview-docx-render-021]
---

# Objective

Add current-file find to OnlyPreview. `Cmd/Ctrl+F` opens a find bar in the merged Preview header; the
query, case-sensitivity toggle, match set, active-match navigation, count, and highlighting all
resolve inside the Preview renderer with no cross-view round trip. Monaco delegates to its own find; Markdown/HTML and PDF get
adapters that match on their own text source and highlight through the CSS Custom Highlight API.
Project Search (`Cmd/Ctrl+Shift+F`) stays a separate Shell-owned contract and is not modified.

# Context

- [OnlyPreview preview view merge and find ownership](../../design/onlypreview-preview-merge-find.md)
  — #3 header composition, #4 find ownership and adapters
- [Historical search architecture snapshot](../../design/onlypreview-search-architecture.md) — #3
  keeps the two-contract split and the `findInPage()` prohibition
- [OnlyPreview sub-application](../../features/onlypreview.md) — interaction and layout contracts to
  extend
- [Preview view merge](onlypreview-preview-header-merge-018.md)

# Path

- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/renderer/onlypreview/preview/src/components/PreviewHeader/`
- `src/renderer/onlypreview/preview/src/components/FindBar/` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewFind.store.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewFindDom.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewFindPdf.service.ts` (new)
- `src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.vue`
- `src/renderer/onlypreview/preview/src/components/HtmlPreview/HtmlPreview.vue`
- `src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue`
- `src/renderer/onlypreview/preview/src/components/PdfPreview/PdfPreview.vue`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `tests/onlypreview/`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`

# Delivery

1. Route `Cmd/Ctrl+F` in Main through the existing `before-input-event` mechanism on both visible
   views. It focuses the Preview view and broadcasts one host-scoped find-open event; only matched
   input prevents default. Auto-repeat is ignored. Project Search's `Cmd/Ctrl+Shift+F` must not be
   shadowed.
2. Render the find bar in the merged header: input, case-sensitivity toggle, previous/next, `n/m`
   count, close. Regex and whole-word are explicitly out of scope (design PQ-1, deferred). It is not
   rendered until activated, keeps the header at 43px, and truncates the relative path instead of
   growing. `Esc` and close both clear the query, drop every highlight, and return focus to the
   content.
3. Implement one in-process adapter contract (`find(query, { caseSensitive })` / `reveal` / `clear`)
   resolved by descriptor. The toggle applies uniformly: Monaco receives it as its own find option,
   the DOM and PDF adapters use it to pick the comparison mode and re-run the match set. If tasks 020
   and 021 have landed, `.docx` reuses the DOM adapter unchanged and `.xlsx` registers a cell adapter
   that matches parsed cell data and reveals the cell (its grid is virtualized, like Monaco):
   Monaco delegates to its own find action; Markdown and HTML share the DOM adapter; PDF uses the
   PDF adapter; image, audio, video, and unsupported register nothing and must not open the bar or
   report fabricated matches.
4. DOM adapter: build a flat text plus text-node offset table from the rendered article, match
   substrings under the current case mode, and map matches back to `Range` objects. Rebuild on content,
   selection-revision, or workspace change. Never mutate the sanitized `v-html` output.
5. PDF adapter: cache `page.getTextContent()` for every page so the match set is independent of which
   pages are rendered, map matches to (page, item, character offset), and build `Range` objects
   inside the textLayer spans. Do not import the pdf.js viewer `PDFFindController`.
6. Highlight through `CSS.highlights` with one registered name for all matches and a second for the
   active match, styled with `::highlight()`; a single match spanning multiple text nodes is one
   highlight built from several `Range`s. No `<mark>` insertion, no DOM mutation, no interference with
   the existing selected-grapheme counting.
7. `reveal` scrolls the active match into view (centered where possible) without stealing text
   selection, and PDF reveal works for a match on any page.
8. Keep find state per selection: switching files, workspace, or reloading clears the query, the match
   set, and every highlight before the next content mounts.
9. Update `docs/features/onlypreview.md` interaction and layout contracts in the same delivery: the
   `Cmd/Ctrl+F` row (Monaco plus the new DOM/PDF behavior), the header find-bar layout, and the
   explicit statement that current-file find never uses `webContents.findInPage()`.

# Acceptance

- `Cmd+F` from either view opens the find bar for Markdown, HTML, Monaco, and PDF previews, and does
  nothing for image, audio, video, and unsupported previews.
- Markdown/HTML: the count equals the real number of matches in the rendered article, next/previous
  cycles through them, the active match is visually distinct, and Shell chrome text never matches.
- Toggling case sensitivity re-runs the match set for Markdown, HTML, Monaco, and PDF, updates the
  count, and keeps or clears the active match consistently instead of leaving stale highlights.
- PDF: matches on pages far below the viewport are counted and reachable, and reveal scrolls to the
  correct page with the match highlighted over the canvas.
- Monaco: `Cmd+F` opens Monaco's own find and matches on lines outside the rendered viewport are
  still found.
- Closing with `Esc` or the close button removes every highlight; switching files clears query and
  count without leaking highlights into the next file.
- Selected-text grapheme counts in the Shell status rail still behave exactly as before while
  highlights are active.
- No `<mark>` element is inserted into preview content, and `webContents.findInPage()` is not used
  anywhere.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- Focused ESLint for the changed OnlyPreview TypeScript/Vue files
- `yarn build`
- Electron E2E (`yarn test:e2e:onlypreview`): owner-run on request. Per the overmind rule, agents must
  not launch Electron end-to-end suites unprompted; report them as not run instead.
- `git diff --check`
