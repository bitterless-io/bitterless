---
id: onlypreview-markdown-front-matter-111
scope: strip YAML front matter before Markdown parsing and render only the document body
status: implemented; owner verification pending
depends-on: [onlypreview-safe-markdown-selection-008]
---

# Markdown Front Matter

## Objective

Stop a `SKILL.md`-style YAML header from becoming visible preview content. Strip a valid leading
front-matter block before Markdown compilation and render only the body.

## Required behavior

1. `stripOnlyPreviewFrontMatter(source)` recognises a block only when the first line is exactly
   `---` and a later line is exactly `---` or `...`. It tolerates a leading BOM and CRLF endings and
   returns only the remaining body. Without a closing delimiter it returns the untouched source.
2. `renderOnlyPreviewMarkdown` parses the returned body and keeps its original success contract
   `{ ok: true, html }`; it does not parse, model, or return front matter.
3. `MarkdownPreview.vue` contains only the sanitized body article or its existing error state. It
   has no front-matter card, label, placeholder, toggle, or separate metadata layout.
4. Remove every front-matter-only style and localized string. The existing body width, top padding,
   typography, sanitizer allowlist, and zero-attribute policy remain unchanged.
5. Character counting, surface-ready/error reporting, Find, and Markdown size admission are
   unchanged.

## Layout

```text
┌──────────────── Markdown preview ────────────────┐
│ # First body heading                            │
│                                                │
│ Body content                                   │
└────────────────────────────────────────────────┘

No Front Matter region is rendered.
```

## Expected paths

- `docs/INDEX.md`
- `docs/issues/onlypreview-markdown-front-matter-renders-as-heading.md`
- `docs/plan/README.md`
- `src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service.ts`
- `src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.vue`
- `src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.less`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/onlyPreviewRendering.test.mjs`

## Verification

- Rendering coverage proves a real `SKILL.md` header is absent from output while its body keeps its
  first heading; BOM/CRLF and `...` delimiters are handled; an unclosed leading `---` remains a
  thematic break; and a setext underline inside the body is untouched.
- Source coverage proves the component, styles, i18n, service, and success result expose no
  front-matter UI or YAML parser while the sanitizer allowlist stays unchanged.
- `yarn typecheck:web` shows no new error in the touched files.
- Electron E2E is excluded; the owner verifies the real `SKILL.md`.

## Delivery evidence

- Removed the Front Matter component region, all front-matter-only styles and localized strings,
  and the YAML parsing/model returned to the Vue component.
- `stripOnlyPreviewFrontMatter` now returns only the document body for a valid leading block;
  `renderOnlyPreviewMarkdown` retains its original `{ ok: true, html }` success contract.
- Focused rendering coverage passed 13/13, including body-only `SKILL.md`, BOM/CRLF plus `...`,
  unclosed thematic breaks, body setext headings, sanitizer behavior, and source guards proving no
  front-matter presentation model remains.
- `yarn typecheck:node`, renderer `vue-tsc --noCheck`, focused ESLint, focused Prettier,
  `git diff --check`, and `yarn build` passed.
- Electron, Playwright, and E2E were not run by owner instruction.
