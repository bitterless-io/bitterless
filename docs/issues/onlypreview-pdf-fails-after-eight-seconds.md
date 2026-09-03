# Every PDF Renders and Then Fails Eight Seconds Later

Status: fixed; owner verification pending

## Symptom

A PDF opens and displays correctly. A few seconds later the preview is replaced by
`Preview could not be loaded — The built-in PDF viewer did not render this document.` Switching to
another PDF renders correctly and then fails the same way. Rapidly switching between PDFs never
shows the error; it only appears on whichever PDF is left open.

## Evidence

`~/Library/Logs/Bitterless_PREVIEW/onlypreview/onlypreview.log`:

```text
event=preview-terminal tag=p2 revision=2  surface=chrome outcome=error elapsedMs=8023
event=preview-terminal tag=p3 revision=4  surface=chrome outcome=error elapsedMs=8011
event=preview-terminal tag=ph revision=17 surface=chrome outcome=error elapsedMs=8027
event=preview-terminal tag=pp revision=26 surface=chrome outcome=error elapsedMs=8015
event=preview-terminal tag=pq revision=28 surface=chrome outcome=error elapsedMs=8017
event=preview-terminal tag=pr revision=30 surface=chrome outcome=error elapsedMs=8015
event=preview-terminal tag=ps revision=32 surface=chrome outcome=error elapsedMs=8014
```

Every failure lands at 8,011–8,027 ms — `DOCUMENT_FRAME_DEADLINE_MS` is 8,000. The failures are the
watchdog firing, not a render error, which is why the document is on screen the whole time.

Counting every `surface=chrome` terminal in that log:

| outcome | count |
| --- | --- |
| ready | **0** |
| error | 7 |
| superseded | 19 |

The Chrome PDF surface has **never once reached `ready`**. Rapid switching only hides the bug: each
new selection supersedes the pending watchdog before its 8 seconds elapse, so the error appears only
on the PDF the owner stops on.

## Root cause

`awaitDocumentFrameFinish` treats readiness as: a `did-frame-finish-load` for a **non-main frame**
whose `frame.url` is exactly the navigation URL.

```ts
if (isMainFrame) return;
const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
if (!frame || frame.isDestroyed() || frame === webContents.mainFrame || frame.url !== navigationUrl) {
  return;
}
```

That predicate is never satisfied for Chromium's PDF viewer, so the deadline always wins. The
intent behind it is sound and documented in the code — the main frame's `did-finish-load` fires even
for a blank viewer, so a coarser signal would report a PDF ready before PDFium has a page model —
but the equality on `frame.url` is not a property the viewer's inner frame actually has.

The zero-`ready` count proves the predicate never matches. It does not by itself separate "the event
fires with a different URL" from "no sub-frame event fires at all", so the repair covers both.

## Repair contract

- Readiness still requires a non-main frame's own `did-frame-finish-load`, and still rejects a
  destroyed frame or the main frame. The `frame.url` equality is dropped: it is provably never true
  and it is the sole reason the signal is unreachable.
- The deadline stops being a verdict on its own. When it expires, the view is inspected: if the PDF
  viewer has actually created a sub-frame, the preview is reported ready; only a document with no
  sub-frame at all is reported as `PDF_VIEWER_UNAVAILABLE`. A visibly rendered PDF can no longer be
  replaced by a failure card.
- The deadline path records the observed sub-frame count so the next occurrence distinguishes "the
  event never fired" from "it fired and was rejected", which this log could not.
- Navigation fencing, session protocol installation, revision/runtime fencing, supersede behavior,
  and the `render-process-gone` failure path are unchanged.

Delivery: [onlypreview-pdf-document-frame-readiness-114](../plan/tasks/onlypreview-pdf-document-frame-readiness-114.md).
