# Cmd+F Does Nothing While a PDF Is Previewed

Status: fixed by [task 114](../plan/tasks/onlypreview-pdf-document-frame-readiness-114.md); owner verification pending

## Symptom

With a PDF on screen, Cmd+F opens the find bar and accepts typing, but the match counter stays
blank, next/previous stay disabled, and nothing highlights. The owner asked whether searching inside
a PDF is achievable at all.

## Root cause

It is achievable, and nothing about PDF text is the problem: `webContents.findInPage` is **never
called** for a PDF.

`ONLY_PREVIEW_ADAPTERS` routes `chromium-pdf` to `{ surface: 'chrome', find: { mode:
'webcontents-find' } }`, which is correct. But `OnlyPreviewFindService.submit()` ends with
`if (this.state.state === 'ready') this.dispatchCurrent();`, and `dispatchCurrent()` is the only
caller of `findInPage`. `deriveState` returns `pending` while `presentation.status === 'loading'`,
and for a PDF that status is only lifted by `handleChromeReady`, which is only reached from
`awaitDocumentFrameFinish`. `open()` refuses only an `unavailable` state, so the bar opens on a
pending PDF and looks like it should work.

The readiness predicate was unsatisfiable: it required a `did-frame-finish-load` whose own frame URL
equalled the navigation URL. Chromium's OOPIF PDF viewer builds an extension shell frame that
commits at `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/…`, so that equality never held.
Every PDF therefore sat pending for 8 seconds and was then replaced by the `PDF_VIEWER_UNAVAILABLE`
card — the same defect the owner reported separately as "PDF flips to could-not-be-loaded".

Log evidence, `~/Library/Logs/Bitterless_PREVIEW/onlypreview/onlypreview.log` (2026-09-03):
`surface=chrome` records 15 `error` — every one at 8,011–8,038 ms — and 2 `ready`, both at
~310 ms, i.e. the `did-finish-load` path used by `html-page`, never a PDF.

`findInPage` itself does reach PDFium in this Electron. Electron 40.10.6 ships Chromium 144 with the
OOPIF PDF viewer (`PdfNavigationThrottle` / `PdfURLLoaderRequestInterceptor` in
`electron_browser_client.cc`), so the PDF content frame is an ordinary frame of the same
`WebContents` that `FindRequestManager` enumerates, and Blink's `find_in_page.cc` routes a find
request to `WebPlugin::StartFind` when the frame hosts a plugin.

## Repair contract

- Task 114's repair is the fix: the readiness listener no longer tests the event frame's URL, and
  the 8-second deadline inspects the view instead of ruling on it.
- Readiness now tests the **subtree** rather than the event: on each non-main
  `did-frame-finish-load`, ready is reported only when `mainFrame.framesInSubtree` contains a live
  frame whose `url` equals the navigation URL. That separates "the viewer shell loaded" from
  "PDFium has the document" — reporting ready too early would dispatch the owner's query into an
  empty viewer. The deadline keeps the looser "any sub-frame" rule as a fallback.
- Cmd+F stays intercepted by Main. Releasing the key to the Chrome view buys nothing: Chromium's PDF
  extension has no find UI of its own and Electron does not implement Chrome's find bar, so the
  owner would lose the app's find bar and get nothing back.
- Nothing in the find registry or the find service changes.

## Verification

The owner opens a text PDF, leaves it past eight seconds, and confirms `surface=chrome outcome=ready`
appears in `onlypreview.log` with no `outcome=error elapsedMs≈8000`, then presses Cmd+F and types a
word present in the document.
