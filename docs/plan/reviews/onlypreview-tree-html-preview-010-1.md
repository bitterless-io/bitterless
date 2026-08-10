---
id: onlypreview-tree-html-preview-010-1
status: pass
reviewed_task: onlypreview-tree-html-preview-010
target: working-tree-2026-08-09
base: cf9ca882649f17dd34b3dc4089ccf88ca2be2670
date: 2026-08-09
review_type: independent-static-and-node-no-runtime
---

# Verdict

**PASS. No open P1, P2, or P3 finding.** Task 010 satisfies its tree-overflow, inert-HTML,
selection-lifecycle, and renderer-only boundary contracts. Deep-tree reachability and visual HTML
acceptance remain with Ral for manual verification.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Contract Evidence

- The Project header and search remain fixed flex items while only the tree viewport owns
  `overflow: auto`. Each 27px row uses `width: max-content` plus `min-width: 100%`, preserves
  depth-based padding, and removes row/name clipping. The existing button remains the complete
  hover, selected, click, keyboard, and context-menu target, and the crosshair locator still calls
  `scrollIntoView({ block: 'center', inline: 'nearest' })`
  (`docs/features/onlypreview.md:501-503,520-524`;
  `src/renderer/onlypreview/shell/src/App.less:271-342`;
  `src/renderer/onlypreview/shell/src/App.vue:176-232,412-430`).
- `.html` and `.htm` remain ordinary `kind: 'text'` descriptors with `language: 'html'`; the
  existing Preview store still obtains their complete content through `readText`. `PreviewSurface`
  routes exactly those two extensions to `HtmlPreview` before Monaco, while `.xml`, `.vue`, and
  other text retain the source path (`docs/features/onlypreview.md:262-284`;
  `src/main/onlypreview/onlyPreviewClassifier.service.ts:19-68,109-165`;
  `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:83-113`;
  `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue:45-67,214-224`).
- The HTML service checks both the declared size and UTF-8 encoded size against exactly 1 MiB,
  rejects invalid size metadata, and catches sanitizer failures. DOMPurify receives an explicit
  semantic tag allowlist, `ALLOWED_ATTR: []`, XHTML as the only namespace, disabled ARIA/data
  attributes, and explicit dangerous-content removal covering active, form, frame, object,
  SVG/MathML, media, image, and resource elements
  (`docs/features/onlypreview.md:279-284,589-596`;
  `src/renderer/onlypreview/preview/src/onlyPreviewHtml.service.ts:8-140`).
- `HtmlPreview` passes only the sanitizer result to `v-html`. Its DOM selection count uses the
  existing endpoint-inside-root helper; every activation first disposes and reports zero, failed
  renders never arm, successful current renders install one listener before arming, and transition,
  failure, revision-key replacement, and unmount all remove the listener and reset the count
  (`docs/features/onlypreview.md:299-311,548`;
  `src/renderer/onlypreview/preview/src/components/HtmlPreview/HtmlPreview.vue:1-84`;
  `src/renderer/onlypreview/preview/src/onlyPreviewCharacterCount.service.ts:23-39`).
- The HTML surface reuses the white canvas, system body typography, Royal Blue headings, bordered
  tables, and monospace code. It adds no card shell, toolbar, animation, transition, shadow, or
  alternate theme (`docs/features/onlypreview.md:506-519`;
  `src/renderer/onlypreview/preview/src/components/HtmlPreview/HtmlPreview.less:1-180`).
- Task-scoped source guards confirm no HTML kind, asset URL, Main/XPC/preload method, iframe,
  `webview`, or CSP relaxation was added. The Preview CSP retains `frame-src 'none'`, and the
  shared API contains no HTML-specific privileged method
  (`docs/plan/tasks/onlypreview-tree-html-preview-010.md:58-76`;
  `tests/onlypreview/onlyPreviewCore.test.mjs:1665-1799`).

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/*.test.mjs` | PASS — 66/66 |
| Focused HTML renderer tests | PASS — semantic structure, zero attributes, hostile/malformed content, declared/encoded 1 MiB limits |
| Additional in-memory JSDOM probes | PASS — malformed form/object nesting, SVG/MathML namespace payloads, mutation-XSS shape, script, and raw-text elements left no dangerous node, attribute, or URL |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS |
| Focused ESLint over task TS/Vue/MJS files | PASS |
| Task-scoped `git diff --check` | PASS |

# Runtime Boundary

This review did not launch Electron, Playwright, E2E, the full Bitterless application, a build, or
any Keychain-capable path. Ral retains manual acceptance of horizontal reachability for deeply
indented long names, whole-row interaction after horizontal scrolling, and ordinary/hostile HTML
presentation in the native Preview pane.
