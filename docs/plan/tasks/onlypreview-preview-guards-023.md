---
id: onlypreview-preview-guards-023
scope: Bound every preview input by size and identity before an engine loads, and cap PDF rendering
status: pending
depends-on: [onlypreview-preview-header-merge-018]
---

# Objective

Close the "input size has no ceiling" class of problems in the Preview view before new format engines
arrive. Make the extension/signature mismatch state explicitly say the extension disagrees with the
content, add renderer-side defense-in-depth verification before any engine parses bytes, and cap PDF
rendering by page count and byte size with on-demand page rendering instead of rendering every page
eagerly.

# Context

- [OnlyPreview preview format coverage](../../design/onlypreview-format-coverage.md) — #8 guards
  G5/G6/G7 and the existing extension → sniff → signature → size chain
- [OnlyPreview sub-application](../../features/onlypreview.md) — classification, state/error, and
  verification contracts

# Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/renderer/onlypreview/preview/src/components/PdfPreview/PdfPreview.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`

# Delivery

1. Keep the existing chain intact: extension routing, 8KiB text sniffing, magic-number signature
   checks, and the text/Markdown/HTML byte limits. This task adds ceilings; it must not weaken or
   reorder those checks.
2. Give `SIGNATURE_MISMATCH` a dedicated localized state that says the file's extension does not match
   its content, shows type/size/modified metadata, and offers the existing file actions. It must not
   read as a generic render failure.
3. Add a shared renderer-side guard used before any engine touches bytes: verify the fetched
   `ArrayBuffer`'s length against the kind's limit and its leading bytes against the expected
   signature, then hand off. Main stays authoritative; this is defense in depth.
4. Add `ONLY_PREVIEW_MAX_PDF_BYTES` and `ONLY_PREVIEW_MAX_PDF_PAGES`. A PDF beyond the byte limit
   renders the bounded "exceeds preview limit" state without parsing. A PDF beyond the page limit
   renders the allowed pages plus a localized notice naming the cap.
5. Replace eager full-document PDF rendering with on-demand page rendering: render pages near the
   viewport, release canvases for pages far outside it, and keep the existing generation/cancel
   discipline so a file switch cancels work and disposes tasks.
6. Keep PDF text selection and the selected-grapheme count working for rendered pages, and keep the
   match-source/highlight split described in the design docs intact so task 019's PDF adapter can
   index every page while highlighting only rendered ones.
7. Add localized copy in both `en` and `zh` for the mismatch, byte-limit, and page-limit states.
8. Update `docs/features/onlypreview.md` classification, state/error, layout, and verification
   contracts in the same delivery.

# Acceptance

- An MP4 renamed to `.pdf`, `.png`, and `.mp3` each render the extension/content mismatch state with
  no asset URL issued and no engine loaded.
- An MP4 renamed to `.txt` and `.md` still resolves to the unsupported state after the 8KiB sniff, and
  the file body is never read in full.
- A PDF above the byte limit shows the limit state without pdf.js parsing it; a PDF above the page cap
  renders the allowed pages plus the localized notice.
- A large multi-hundred-page PDF scrolls without rendering every page up front; memory does not grow
  monotonically while scrolling back and forth.
- Switching away from a large PDF cancels pending render/text-layer tasks and releases canvases.
- Text selection, the status-rail character count, and existing PDF behavior are unchanged for
  rendered pages.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- Focused ESLint for the changed OnlyPreview TypeScript/Vue files
- `yarn build`
- Electron E2E (`yarn test:e2e:onlypreview`): owner-run on request. Per the overmind rule, agents must
  not launch Electron end-to-end suites unprompted; report them as not run instead.
