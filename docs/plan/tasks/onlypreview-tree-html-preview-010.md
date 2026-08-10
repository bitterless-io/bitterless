---
id: onlypreview-tree-html-preview-010
scope: Make deep Project paths horizontally scrollable and safely render HTML in the Preview pane
status: implemented; owner verification pending
depends-on: [onlypreview-safe-markdown-selection-008]
---

# Objective

Keep complete deep file and folder names reachable through horizontal scrolling in the Project
tree, and render `.html`/`.htm` files as inert semantic documents in the existing right-hand
Preview pane instead of showing their source in Monaco.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/design/colors.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-safe-markdown-selection-008.md`

# Layout

```text
┌──────────── Project ────────────┬──────────── Preview ─────────────┐
│ Search files…                   │ report.html               HTML │
│ ▾ deeply                        ├──────────────────────────────────┤
│   ▾ nested                      │                                  │
│     ▾ directory                 │ inert semantic HTML document     │
│       complete-long-name.html ──┼─► headings · prose · tables      │
│ <──────── horizontal scroll ──> │                                  │
└─────────────────────────────────┴──────────────────────────────────┘
```

# Path

- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/shell/src/App.less`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/HtmlPreview/`
- `src/renderer/onlypreview/preview/src/onlyPreviewHtml.service.ts`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-tree-html-preview-010.md`

# Implementation Constraints

1. Keep the Project header and search fixed. The existing tree viewport alone owns vertical and
   horizontal scrolling. A row is at least the viewport width but grows to its intrinsic width from
   indentation, icons, and the complete single-line name. Remove the row/name clipping that
   prevents `scrollWidth`; preserve the 27px row height, full-row hover/selection/click target,
   keyboard navigation, search, expansion, and `scrollIntoView({ inline: 'nearest' })` locator.
   Do not persist horizontal position.
2. Keep `.html` and `.htm` classified as `kind: 'text'` with `language: 'html'`. Reuse the existing
   capability-scoped `readText` result and route only those two extensions to `HtmlPreview` before
   Monaco. Do not add an HTML kind, asset token, file URL, Main method, XPC method, preload bridge,
   iframe, or `webview`.
3. Render HTML only after current direct DOMPurify sanitization. Allow a bounded semantic
   document/list/table/code tag set with zero attributes. Scripts, styles, templates, forms,
   frames, objects, embeds, SVG/MathML, media, event handlers, `href`, `src`, and every remote,
   data, local, navigation, or new-window path must not survive. Dangerous tag contents are
   discarded rather than executed or presented as markup.
4. Limit semantic HTML rendering to 1 MiB using both declared and UTF-8 encoded size. Larger or
   failed input shows a localized render state and does not fall back to executable/raw HTML. Other
   text retains the existing complete-or-error 8 MiB read boundary.
5. Use the existing white Preview canvas, system typography, Royal Blue semantic accents, bordered
   tables, and monospace code without cards, toolbars, animations, or a second theme. The rendered
   document is selectable, read-only, scroll-owned, and responsive within the right pane.
6. Reuse the existing renderer-only character-count revision protocol. Count a DOM selection only
   when both endpoints are inside the HTML document, arm only after a successful current render,
   dispose the listener, and report zero on collapse, transition, failure, or unmount. Do not change
   any event payload, Main/preload boundary, or persisted state.
7. Preserve the current Agent Skill/Guide and all unrelated Coin/Trench/Todo/E2E work in the shared
   working tree. Do not run Electron, Playwright, E2E, the full Bitterless application, `yarn
   build`, or any Keychain-capable path.
8. Keep `truncated: true` and the compact `INDEX PARTIAL` status, but remove the explanatory
   “Showing the first …” block beneath the tree together with its dedicated copy and styling.
9. Keep the existing 5px keyboard/pointer resize target and Main geometry unchanged, but remove its
   visible left/right borders, center rule, and contrasting fill. Style the Project tree's vertical
   and horizontal Chromium scrollbars to exactly 8px, with transparent track and corner.

# Verification

- Pure Node tests for allowed headings/prose/lists/tables/code and hostile HTML containing scripts,
  styles, handlers, forms, frames, objects, SVG/MathML, links, images, remote/data/file URLs,
  malformed markup, and the 1 MiB boundary
- Source guards for `.html`/`.htm` routing before Monaco, `.xml`/`.vue` source fallback, exact
  zero-attribute sanitizer configuration, selection-listener cleanup, and unchanged Main/preload
  boundaries
- Source layout guards for tree `overflow: auto`, intrinsic row width, complete unellipsized names,
  depth-based indentation, unchanged nearest-inline current-file location, and absence of the
  partial-index explanatory block; require 8px horizontal/vertical scrollbars and a borderless,
  rule-free functional resize target
- `node --test tests/onlypreview/*.test.mjs`, `yarn typecheck:node`, renderer i18n, focused ESLint,
  and `git diff --check`
- No Electron/Playwright/E2E/full-app/build/Keychain execution. Ral manually opens a deep tree and
  normal/hostile HTML files to verify horizontal reachability and right-pane semantic rendering.

# Delivery Evidence

- Project rows now use intrinsic width with a viewport-width floor, so complete deep names create
  horizontal overflow without moving the Project header or search controls.
- `.html` and `.htm` remain capability-scoped text reads and route before Monaco to a 1 MiB,
  zero-attribute DOMPurify semantic renderer. No HTML-specific Main, XPC, preload, asset, iframe, or
  navigation capability was added.
- HTML selection counting reuses the existing renderer-only revision fence and resets on failed
  render, transition, and unmount.
- A partial index now keeps only the compact `INDEX PARTIAL` status; the former explanatory block,
  dedicated localized copy, and dedicated style are removed.
- The Project tree owns local 8px horizontal and vertical scrollbars with transparent track/corner.
  The functional 5px resize target has no borders or center rule and shares the Project surface
  token, so it introduces no third-color divider stripe.
- `node --test tests/onlypreview/*.test.mjs`: PASS, 66/66.
- `yarn typecheck:node`, `yarn check:renderer-i18n`, focused ESLint, and task-scoped
  `git diff --check`: PASS.
- Independent reviews `onlypreview-tree-html-preview-010-1` and `-2`: PASS. Round `-3` identified
  the transparent-handle third-color stripe; Round `-4` confirms the shared-surface fix and passes
  with no open P1/P2/P3 finding.
- Electron, Playwright, E2E, the full application, build, and Keychain-capable paths were not run.
  Ral retains manual visual/runtime acceptance.
