# PDF can cover Global Search and accept Find before its text is ready

Status: fixed in source; owner verification pending

## Symptoms

- `Shift+Cmd+F` can show Global Search behind an open Chromium PDF.
- `Cmd+F` opens the current-file Find UI but a PDF can return no matches even when it contains text.

## Root causes

Global Search is already a dedicated trusted `WebContentsView`, but Main gives it only the Preview
rectangle. The rest of the window depends on a Shell DOM scrim. PDF's built-in document frame is
created after the raw Chrome view is first attached; current code raises Search only at that first
attachment and does not raise it again when the late PDF frame becomes ready.

The Find registry and command route are correct: `chromium-pdf` uses the active raw Chrome
`webContents.findInPage()`. Readiness is not. Current code marks PDF ready when a matching child
frame merely exists. PDFium returns a final zero-result Find while its page model is still empty and
does not retain/replay that query, so a query dispatched in this gap is lost.

## Accepted repair

- Size the transparent native Search view to the complete OnlyPreview content area. Keep the
  opaque rounded workspace at the current Preview rectangle with the existing 24px inset.
- The Search renderer owns every outside-workspace hit. A click on any transparent area consumes
  the event, closes with `mode: 'opener'`, and never reaches Shell. Retire the Shell DOM scrim.
- Preserve `Shell < active Preview < Search`; re-raise Search when the exact PDF document frame
  finishes loading, not only when Chrome first attaches.
- Keep PDF Find on Chromium `findInPage()`. Hold adapter readiness and an entered query in pending
  state until `did-frame-finish-load` identifies the exact non-main frame whose URL equals the
  current navigation URL. Then existing pending→ready synchronization dispatches that query once.
- Bound and generation-fence the frame wait. Ignore main-frame, foreign URL, stale view/revision,
  and late events. Do not inject scripts, add PDF.js, parse PDF in Main/preload, or add OCR.

## Acceptance

- Search is always topmost over PDF/HTML/Vue while its panel stays at the current position and size.
- The native Search view spans the whole OnlyPreview content area, paints only the existing inset
  workspace, and closes on any transparent-background click.
- A PDF child frame that merely exists cannot publish ready. The exact frame finish publishes ready
  once, re-raises Search, and replays at most one current pending Find query.
- PDF Find highlights/navigates through Chromium; scan-only PDFs truthfully return zero.
- Focused Node/source tests, type checks, lint, i18n, and build pass; Electron/E2E remain owner-run.

## Resolution

Implemented by [Task 100](../plan/tasks/onlypreview-pdf-search-overlay-find-100.md).
[Independent review 1](../plan/reviews/onlypreview-pdf-search-overlay-find-100-1.md) passed; Ral owns
remaining real-app verification with a text PDF and Global Search opened over it.
