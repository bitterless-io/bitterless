---
id: onlypreview-pdf-document-frame-readiness-114
scope: make the Chrome PDF surface reachable by dropping an unsatisfiable readiness predicate and stopping the deadline from failing a rendered document
status: implemented; owner verification pending
depends-on: [onlypreview-pdf-network-delivery-028]
---

# PDF Document Frame Readiness

## Objective

Let a rendered PDF stay on screen. Today the Chrome preview surface can never report ready, so its
8-second watchdog always fires and replaces a correctly rendered document with a failure card.

Issue: [`onlypreview-pdf-fails-after-eight-seconds.md`](../../issues/onlypreview-pdf-fails-after-eight-seconds.md).

## Required behavior

1. `awaitDocumentFrameFinish` accepts a `did-frame-finish-load` from any live non-main frame. The
   `frame.url !== navigationUrl` rejection is removed; it was never satisfied by Chromium's PDF
   viewer, which is why the surface recorded zero `ready` outcomes and seven 8-second timeouts.
2. The deadline inspects the view instead of ruling on it. With at least one live sub-frame the
   preview reports ready; only a view with no sub-frame reports `PDF_VIEWER_UNAVAILABLE`, and its
   message now says the viewer never created a document frame.
3. The deadline path emits `[onlypreview] event=pdf-frame-deadline documentFrames=<n>` so a future
   occurrence separates "no sub-frame event fired" from "one fired and was rejected" — a distinction
   the existing log could not make.
4. `navigationUrl` is still passed to `awaitDocumentFrameFinish`, but it is tested against the
   frame **subtree** rather than against the event's frame: ready is reported only once
   `mainFrame.framesInSubtree` holds a live frame at that URL. The OOPIF viewer builds an extension
   shell frame first, and readiness is what unblocks find — reporting it before PDFium has the
   document would dispatch the owner's query into an empty viewer. The deadline keeps the looser
   "any sub-frame" rule.
5. This is also the fix for Cmd+F on a PDF: the find state machine parks a preview in `pending`
   until `status` leaves `loading`, and `dispatchCurrent()` — the only caller of `findInPage` — is
   ready-gated. See
   [`onlypreview-find-never-dispatches-for-pdf.md`](../../issues/onlypreview-find-never-dispatches-for-pdf.md).
5. Navigation fencing, session protocol installation, partition constancy, runtime/revision fencing,
   supersede behavior, and the `render-process-gone` path are unchanged.

## Verification

- The log evidence is the acceptance baseline: `surface=chrome` currently records 0 `ready`, 7
  `error` at 8,011–8,027 ms, and 19 `superseded`. After the change a PDF left open must record
  `ready` and must not produce a `preview-terminal … surface=chrome outcome=error` at ~8,000 ms.
- `yarn typecheck:node` passes and `yarn build` succeeds.
- Electron E2E is excluded. This path is Chromium PDF viewer behavior inside a packaged runtime and
  cannot be exercised by the source-level suites; the owner verifies by opening a PDF and leaving it
  open past eight seconds.
