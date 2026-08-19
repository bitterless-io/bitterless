---
id: onlypreview-docx-render-021
scope: Render .docx documents with Word-like pagination inside the Preview view
status: pending
depends-on: [onlypreview-preview-header-merge-018, onlypreview-preview-guards-023]
---

# Objective

Preview `.docx` documents as laid-out pages instead of the `unsupported` state, using `docx-preview`
inside the Preview renderer over the existing `onlypreview://` asset stream. Embedded images render
from the document's own package as `blob:` URLs; the generated DOM is sanitized before insertion; no
network request, macro, or OLE object ever executes. Legacy binary `.doc` stays out of scope pending
design PQ-A.

# Context

- [OnlyPreview preview format coverage](../../design/onlypreview-format-coverage.md) — #3 docx
  decision, #6 truthful states, #7 engine loading, PQ-A
- [OnlyPreview sub-application](../../features/onlypreview.md) — classification, rendering, and
  security contracts

# Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/renderer/onlypreview/preview/src/components/DocumentPreview/`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewDocument.service.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `package.json`
- `tests/onlypreview/`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`

# Delivery

1. Add `docx-preview` with `yarn add` (no npm/pnpm) and classify `.docx` as a new `document` kind with
   the correct MIME. Keep the existing asset-token read path. Require the OOXML zip magic
   `50 4B 03 04` in `matchesSignature()`; a mismatch yields `SIGNATURE_MISMATCH` with no `assetUrl`
   (design #8 G1).
1a. Add `ONLY_PREVIEW_MAX_DOCUMENT_BYTES` (25MiB) and bound zip expansion to 200MiB / 5,000 entries.
   The dynamic `import()` of `docx-preview` runs only after the signature and size gates pass
   (design #8 G2/G3/G4).
2. Render in the Preview renderer from `ArrayBuffer`, reusing the generation/abort discipline so file
   switches cancel in-flight rendering and dispose the produced DOM.
3. Sanitize the generated DOM before it is attached: drop `script`, `iframe`, `object`, `embed`,
   external stylesheet links, and any remote resource reference. Embedded images resolve to `blob:`
   URLs created from the document package and are revoked on dispose.
4. Render paragraph, list, and table styles, headers/footers, and pagination. Missing embedded fonts
   fall back to system fonts without failing the render.
5. Do not render tracked changes or comments, do not evaluate field codes, and never execute macros or
   OLE content.
6. Distinguish truthful states: rendered, page/size limit exceeded (bounded localized notice plus file
   actions), and parse failure. `.doc`, `.rtf`, and `.odt` keep the existing unsupported state with
   external-open actions.
7. Load `docx-preview` through the documented Preview-engine dynamic-import exception.
8. Add localized copy in both `en` and `zh`, and update
   `docs/features/onlypreview.md` classification, rendering, security, and verification contracts in
   the same delivery.

# Acceptance

- A `.docx` with headings, lists, tables, and inline images renders as paginated content with those
  elements visible and correctly ordered.
- No network request leaves the renderer while a document with remote image references is open.
- `<script>`, `<iframe>`, and external stylesheet references present in a crafted document never reach
  the attached DOM.
- Switching away disposes the render, revokes every created `blob:` URL, and cancels pending work.
- A corrupt `.docx` shows the truthful failure state; `.doc` still shows the unsupported state with
  file actions.
- An MP4 renamed to `.docx` shows the extension/content mismatch state; `docx-preview` is never
  loaded and no asset URL is issued.
- A document above 25MiB shows the limit state without parsing.
- Find (task 019) works over the rendered document through the existing DOM adapter without a
  document-specific code path.
- `docx-preview` does not appear in the Preview renderer's initial chunk in `yarn build` output.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- Focused ESLint for the changed OnlyPreview TypeScript/Vue files
- `yarn build`
- Electron E2E (`yarn test:e2e:onlypreview`): owner-run on request. Per the overmind rule, agents must
  not launch Electron end-to-end suites unprompted; report them as not run instead.
