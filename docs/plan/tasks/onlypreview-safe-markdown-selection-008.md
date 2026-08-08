---
id: onlypreview-safe-markdown-selection-008
scope: Safely render Markdown and show selected-text character counts in OnlyPreview's bottom rail
status: implemented; owner verification pending
depends-on: [onlypreview-e2e-keychain-isolation-007]
---

# Objective

Render ordinary Markdown as a safe, readable document instead of Monaco source, and show a
grapheme-aware character count in the existing Shell-owned bottom status rail whenever text is
selected in Monaco, Markdown, or PDF.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/design/colors.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-shell-ux-005.md`

# Layout

```text
┌──────────────────────────────── Preview view ───────────────────────────────┐
│ README.md                                                     MARKDOWN      │
├─────────────────────────────────────────────────────────────────────────────┤
│             ┌──────── readable column, max 860px ────────┐                 │
│             │ # Heading                                  │                 │
│             │ body, lists, table, quote, code            │                 │
│             └─────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────── Shell-owned 25px status rail ───────────────────┐
│ INDEX READY                     SELECTED 24 CHARACTERS · MARKDOWN · 18 KB   │
└─────────────────────────────────────────────────────────────────────────────┘
```

# Path

- `package.json`
- `yarn.lock`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.less`
- `src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue`
- `src/renderer/onlypreview/preview/src/components/MarkdownPreview/`
- `src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewCharacterCount.service.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-safe-markdown-selection-008.md`

# Implementation Constraints

1. Add direct `marked@18.0.7` and `dompurify@3.4.12` dependencies. Do not use `markstream-vue`, a
   transitive parser dependency, a home-grown sanitizer, raw unsanitized `v-html`, remote rendering,
   Mermaid, KaTeX, or executable Markdown extensions.
2. Render only `.md`; keep `.markdown` and `.mdx` in read-only Monaco source. Do not expand the
   existing file-association/classifier contract or add a new public preview kind or Main API.
3. Compile at most 1 MiB of Markdown. Escape raw HTML as visible text, convert images to inert
   alt-text placeholders, and sanitize through a semantic-tag allowlist with no attributes. No
   `href`, `src`, style, event handler, form, script, frame, SVG/MathML, remote/data/local resource,
   navigation, or new-window path may survive.
4. Keep the Markdown surface selectable and read-only. Use one centered, scroll-owned document
   column (maximum 860px) inside the existing white Preview canvas, existing typography/palette,
   Royal Blue accents, bordered tables, and monospace code. Add no card chrome, toolbar, animation,
   or new settings.
5. Count Unicode grapheme clusters with `Intl.Segmenter`; fallback to Unicode code points only when
   Segmenter is unavailable. Include whitespace and line breaks. Monaco sums all non-empty
   selections; Markdown/PDF accept a DOM selection only when both endpoints are inside the Preview
   body.
6. Keep the selected-count broadcast payload exactly `{ hostId, characterCount }`. Renderer-only
   lifecycle broadcasts may carry only `{ hostId, revision }` or `{ hostId }`, where `revision` is
   opaque and contains no path, selected text, file content, or capability. Add no Main handler or
   preload function. Shell accepts only its current host and revision, then conditionally displays
   the localized count before type/size in the fixed 25px status rail.
7. Fence selection reports across workspace/file transitions, async restore, rapid consecutive
   changes, and either renderer reloading. Dispose selection listeners and report zero on
   collapsed/outside selection, file change, loading/error, renderer/component unmount, and stale
   content. Do not change read-only behavior, file contents, existing layout geometry, or native
   Preview bounds.
8. Preserve all retained E2E files and the mock-Keychain launch boundary. Do not run Electron,
   Playwright, E2E, or the full Bitterless application in this delivery.

# Verification

- Pure Node tests for Markdown output and hostile inputs: raw HTML, script/style/frame/form,
  handlers, `javascript:`/`data:`/remote/local URLs, images, malformed HTML, and allowed semantic
  headings/lists/tables/code
- Pure Node tests for grapheme counting: ASCII, Chinese, emoji/ZWJ, combining marks, whitespace,
  line breaks, empty text, and multiple selections
- Source/integration guards for `.md` routing, `.markdown`/`.mdx` Monaco fallback, DOM/Monaco
  listener disposal/reset, exact host-scoped renderer payloads, revision readiness/resync,
  status-rail placement, and i18n
- Pure Node state probes for deferred restore, old-zero then old-nonzero delivery, rapid A→B→C
  transitions, stale readiness, and Shell/Preview renderer reload resynchronization
- Focused typecheck/ESLint and `git diff --check`; no Electron/Playwright/E2E/full-app launch
- Ral manually opens normal and hostile Markdown, then selects text in Markdown, code, and PDF to
  verify rendering, selection count, and bottom-rail behavior.

# Delivery Evidence

- Implemented on 2026-08-08. `.md` files now use a centered, selectable 860px reading surface;
  `.markdown` and `.mdx` remain read-only Monaco source. Direct pinned `marked@18.0.7` and
  `dompurify@3.4.12` dependencies were installed with lifecycle scripts disabled.
- Markdown rendering is capped at 1 MiB, escapes raw HTML as visible text, replaces images with
  inert alt-text placeholders, and passes every result through a semantic-tag/zero-attribute
  DOMPurify allowlist. No active link, resource, form, frame, SVG/MathML, style, or event-handler
  path remains.
- Monaco sums all non-empty selections; Markdown and PDF count only selections whose two endpoints
  remain inside their preview surface. Counts use `Intl.Segmenter` graphemes with a code-point
  fallback, and Preview broadcasts only `{ hostId, characterCount }`; Shell validates the exact
  current-host payload, resets it across content changes, and renders it in the unchanged 25px rail.
- Round 1 closed the async restore race with a Shell-issued opaque revision. Preview disarms before
  restoring, rejects reports from old components, announces readiness only after the replacement
  surface is installed, and requests revision resynchronization after reload. Shell gates or
  buffers only the current ready revision, so old zero/non-zero delivery and rapid A→B→C
  transitions cannot repopulate the rail. Lifecycle payloads remain renderer-only and carry no
  path, text, content, or capability; the selected-count payload is unchanged.
- `node --test tests/onlypreview/*.test.mjs` passed 55/55 pure Node/source tests, including hostile
  Markdown, the 1 MiB boundary, semantic/zero-attribute output, Unicode/ZWJ/combining-mark counts,
  multi-selection sums, DOM endpoint containment, listener disposal, deferred stale reports, rapid
  revisions, renderer resynchronization, and host-scoped wiring.
- `yarn typecheck:node`, `yarn check:renderer-i18n`, focused error-level ESLint, and
  `git diff --check` passed. Full `yarn typecheck:web` remains blocked only by the repository's
  existing connector, poker-test, Home, and shared typing baseline; it reported no OnlyPreview
  diagnostic.
- Electron, Playwright, E2E, the full Bitterless application, and `yarn build` were not run by
  explicit delivery instruction. Ral should manually open a normal and a hostile `.md`, then select
  text in Markdown, Monaco, and PDF to verify safe rendering and the localized bottom-rail count.
