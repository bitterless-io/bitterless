# PDF Find and the Global Search Overlay Survive Two Rounds of Repair

Status: PDF cause found and fixed; overlay fixed by a different mechanism — owner verification pending

## Symptom

Owner, on a live `yarn dev` run of the current working tree (2026-09-03):

1. The Global Search overlay is still occluded by the PDF preview.
2. `Cmd+F` still does not search a PDF. 「我记得以前是可以的 利用 chromium 自带的 pdf 搜索的方式」 — it
   used to work, using Chromium's own PDF search.

This is the third report of (1) and the second of (2).

## Why this issue exists separately

Both defects already had a repair shipped into this working tree, and the owner's run contains both.
That run therefore **falsifies** the two mechanisms those repairs were built on, and neither may be
re-proposed:

**Falsified — the overlay is stacked below because it is attached before it has painted.**
[Task 117](../plan/tasks/onlypreview-global-search-warm-overlay-117.md) preloads the overlay at
shell-interactive, gates attachment on a `ready` flag set only when `loadView` resolves, raises the
overlay when its own load resolves, and performs every raise as `removeChildView` then
`addChildView`. The overlay can no longer be attached unpainted. It is still occluded.

**Falsified — PDF readiness is unreachable because the listener compared the event frame's URL to
the navigation URL.** [Task 114](../plan/tasks/onlypreview-pdf-document-frame-readiness-114.md)
removed that comparison, and the current predicate tests the frame *subtree*:

```ts
main.framesInSubtree.some((frame) => frame !== main && !frame.isDestroyed() && frame.url === navigationUrl)
```

This repo's own measurement in
[`onlypreview-pdf-blank-in-memory-partition.md`](onlypreview-pdf-blank-in-memory-partition.md)
records the working frame tree as `PDF url` → `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html`
→ **`PDF url` (document frame)**, so a sub-frame at the navigation URL does exist on the persistent
partition now in use. Find still does not work.

## HTML, checked while writing this

The owner also asked that HTML render in the Chrome `WebContentsView` rather than the Vue surface,
because the Vue surface cannot run the page's JavaScript, and that its content be searchable.

Both are already the case, so no routing change was needed. `ONLY_PREVIEW_ADAPTERS` maps
`html-page` to `{ surface: 'chrome', find: { mode: 'webcontents-find' } }`, the Vue
`components/HtmlPreview/` and `components/PdfPreview/` directories are empty leftovers from before
that move, and the only way an HTML file reaches the Vue surface now is through
`getOnlyPreviewDescriptorAdapter`'s `descriptor.previewError` branch, which is the unsupported card
for a file over its size limit — correct behaviour, not a rendering path.

What *was* wrong is the document CSP. `script-src 'self' 'unsafe-inline'` already allowed the page's
own scripts, but `connect-src`, `worker-src`, `child-src`, `frame-src` and `object-src` were all
`'none'`, so any page that fetched a file, used a worker, or embedded a frame rendered incompletely.
Those are now scoped to `'self' data: blob:` — `'self'` being the one-shot document token, so a page
reaches its own sibling resources and nothing else. No `http`, `https` or `ws` source is listed
anywhere, and `base-uri` and `form-action` stay `'none'`.

### What actually stopped `progress_cn.html` rendering

The owner named the file: `projects/mm-roadmap/progress_cn.html`. It is 20 KB with all styles inline
and one remote dependency:

```js
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
```

Three layers each blocked it independently, which is why it rendered as a styled page with an empty
diagram area:

1. The document CSP listed no `https:` source.
2. `session.webRequest.onBeforeRequest` cancelled every `http`, `https`, `ws`, `wss`, `ftp` and
   `file` request outright.
3. The session ran behind a deliberately dead proxy — `http=127.0.0.1:9;https=127.0.0.1:9` with
   `<-loopback>` bypassed.

All three are now open for `https:`/`wss:`, per the owner's standing instruction. **The tradeoff,
stated plainly: a previewed local HTML file can now load remote code and can send data out.** That
is inherent to rendering a document the way a browser would, and it is the owner's decision.

`file:` and `ftp:` stay blocked, which is a different property and is kept — a previewed page reaches
its own sibling resources through the document protocol and nothing else on disk. Downloads,
permission requests and WebRTC stay refused.

**This gives the sharpest discriminator available for the PDF defect.** HTML and PDF share the Chrome
surface, the same find registry entry and the same `findInPage` call. HTML reaches
`status: 'ready'` — the log records `surface=chrome outcome=ready` at ~310 ms for it, through the
plain `did-finish-load` path — and find works there. PDF takes the `awaitDocumentFrameFinish` branch
instead and never reaches ready in any recorded run. So the fault is almost certainly in PDF
readiness, not in `findInPage` (which the owner confirms is the intended API) and not in the find
service.

## Root cause, from the owner's own dev log

The logs were there the whole time. They are not under `~/Library/Logs` — the `debug_prod` profile
writes to `~/Library/Application Support/Bitterless_DEBUG_PROD/logs/`, and
`OnlyPreviewLogService.getLogger()` sets `transports.console.level = false`, so the open trace never
appears in the dev terminal. Two earlier rounds of this investigation guessed at what these files
already recorded.

What they say, in the owner's run:

```text
main.log        event=pdf-frame-deadline documentFrames=2 elapsedMs=8000   (x3)
onlypreview.log event=preview-terminal tag=p5 revision=5  surface=chrome outcome=ready elapsedMs=8035
onlypreview.log event=preview-terminal tag=p7 revision=7  surface=chrome outcome=ready elapsedMs=8018
onlypreview.log event=preview-terminal tag=pd revision=12 surface=chrome outcome=ready elapsedMs=8048
```

**A PDF does reach `ready` — but only through the 8-second deadline, never through the listener.**
My earlier claim in this issue that it "never reaches ready in any recorded run" was wrong. Two live
sub-frames existed the whole time (`documentFrames=2`) and no `did-frame-finish-load` match ever
occurred, so the subtree predicate from task 114 is unsatisfied too: the repair changed the
predicate without changing the outcome.

The mechanism: the viewer's inner content frame is handed a stream by the PDF extension rather than
performing a navigation of its own, so it never reports a frame load. Only the extension shell frame
fires the event, and it fires before the content frame commits.

**And that 8-second wait is the entire find symptom.** `dispatchCurrent()` is gated on the find state
being `ready`, which is gated on the presentation leaving `status: 'loading'`. For eight seconds a
typed query sits `pending` and nothing is dispatched. Nobody waits eight seconds before calling it
broken. `webContents.findInPage` — which the owner confirms is the intended API — is fine:
Chromium's `FindRequestManager` searches out-of-process frames of the same `WebContents`, and Blink's
`FindInPage::Find` routes to `WebPlugin::StartFind` when the frame hosts a plugin.

### Why this regressed

`git show c67ac21` — the OnlyPreview MVP — **polled**:

```ts
const timer = setTimeout(() => this.awaitDocumentFrame(…, waitedMs + DOCUMENT_FRAME_POLL_INTERVAL_MS),
  DOCUMENT_FRAME_POLL_INTERVAL_MS);   // 150 ms
```

A later change replaced that poll with the `did-frame-finish-load` subscription. This is exactly what
the owner remembers: 「我记得以前是可以的」.

## Repair

**PDF readiness — the poll is restored.** `awaitDocumentFrame` polls `framesInSubtree` every 150 ms
for a frame at the navigation URL. The 8-second deadline stays, but only as the failure bound, and it
still reports ready when the view has any sub-frame so a rendered document is never replaced by a
failure card. The deadline now records `match=false`, which is the one fact that would say the
*predicate* rather than the *signal* needs replacing if this ever fires again.

**The overlay — stacking is no longer the mechanism.** Child order was verified correct: `attachTopmost`
issues the last `addChildView` on the window, `bounds` is never null by the time a keystroke can
arrive, and no path re-attaches the preview after the overlay. It still rendered under the PDF. So
the attached preview view is now **hidden** (`View.setVisible(false)`) while the overlay is active
and revealed on every way out — close, load failure, teardown. Global Search covers the whole window,
so the preview is fully occluded by it anyway and hiding it costs nothing visually; what it buys is
that a hidden view cannot composite above anything, whatever macOS does with plugin surfaces.

## Still unproven

Whether the macOS compositing hypothesis was ever right. The fix above makes it moot rather than
answering it. The one-minute check that would answer it, if the owner wants to know: open a **Markdown
or image** file (Vue surface) and press Shift+Cmd+F. If the overlay was correct there and wrong only
over a PDF, compositing was the cause; if it was wrong over both, something else was.
