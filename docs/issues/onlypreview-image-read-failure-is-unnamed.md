# Image and Media Previews Fail, and the Failure Cannot Be Named

Status: fixed; owner verification pending

## Symptom

`frame_05.png` (281 KB) shows `Preview could not be loaded — The image data stream could not be
read completely.` Other images fail the same way, and `tmp/video-134/audio.wav` — a valid 344 KB
RIFF/WAVE PCM file — fails its own media preflight. The expectation is the opposite: anything the
web platform can decode should render in the Vue preview.

## Evidence

`onlypreview.log`, Vue surface terminals on 2026-09-03:

```text
04:45:00 preview-terminal surface=vue outcome=ready elapsedMs=54
04:57:02 preview-terminal surface=vue outcome=error elapsedMs=44
04:57:03 preview-terminal surface=vue outcome=error elapsedMs=14
04:57:04 preview-terminal surface=vue outcome=error elapsedMs=20
04:58:18 preview-terminal surface=vue outcome=error elapsedMs=32
04:59:46 preview-terminal surface=vue outcome=ready elapsedMs=88
04:59:55 preview-terminal surface=vue outcome=error elapsedMs=38
04:59:58 preview-terminal surface=vue outcome=ready elapsedMs=93
```

Two facts follow. The Vue surface is not broken — it reaches `ready` repeatedly. And every failure
lands in 14–44 ms, far too fast for a 281 KB stream to have been read and found short. These are
rejections at header time or at the very first await, not truncated reads.

After the first repair named the reason tokens, the owner's next reproduction produced exactly one
of them:

```text
13:11:21 [onlypreview] event=image-read-failed reason=fetch-rejected
```

## Root cause

Two defects, one behind the other.

**The header check.** The image loader and the media preflight shared exactly one check — an
equality against `content-length`:

```ts
const contentLength = Number(response.headers.get('content-length'));
if (!response.ok || response.status !== 200 || contentLength !== expectedSize) { … }
```

An absent header parses as `Number(null) === 0`, which can never equal a non-empty file size, so a
complete response with no header was indistinguishable from a truncated one. That intersection is
what identified the header rather than anything format-specific, and it is what failed `audio.wav`.

**The fetch itself.** With the header fixed, images still failed, now as `reason=fetch-rejected` —
the `fetch()` rejected before a status existed. Every Main-side rejection returned a bare
`new Response(null, { status })` carrying no CORS headers. The preview page is a `file://`
document, so those responses failed the CORS check and reached the renderer as an opaque network
error with no status at all. `response-not-ok` was unreachable: a revoked token, a cancelled read
and a changed source length were all delivered as the same anonymous rejection.

Underneath that, the token itself was being retired too early. An image asset was issued with
`lifetime: 'ttl'` and revoked as a one-shot on ready, on the assumption that the renderer had
already copied the bytes into a blob. Any repeat request — a re-attach, a re-mount, a second
element load — then hit a dead token and 404'd, invisibly.

## Repair contract

- Images render straight from the revision-bound asset URL, the way audio and video already do.
  `OnlyPreviewImageSession` is gone; the store hands the component `{ src }` and the `<img>`
  element performs the request. No `fetch`, no `Blob`, no object URL, and therefore no CORS check
  in front of an image and no second copy of the file in the renderer heap.
- The element's intrinsic size is read on `load`, so every viewport computation is fenced until it
  exists. Fit, zoom, rotate and pan are unchanged once it does.
- An element `error` reports `IMAGE_READ_FAILED`, which is what it now means. Nothing in the
  component decodes, so it can no longer report a decode failure.
- Image, audio and video assets all use `lifetime: 'selection'`. `onlyPreviewAdapterUsesOneShotAsset`
  keeps only `drawio-viewer`, the one adapter that really does copy the file into a document.
- A missing or unparseable `Content-Length` no longer fails the media preflight. When present it
  must still match; the preflight keeps requiring `Accept-Ranges: bytes`, since seeking depends on
  it, and names it separately if it is ever the blocker.
- Every asset response — success or rejection — carries open CORS headers, and every rejection is
  recorded as `[onlypreview] event=asset-rejected reason=<token> status=<n>`, with the sanitized
  cause when one exists. `OPTIONS` is answered rather than refused.
- The preview and shell page CSPs no longer restrict any content-loading directive, by owner
  decision (2026-09-03: 「cors csp 都放开不要有安全限制」). `script-src` stays `'self'`: that is not a
  limit on what can be previewed, only on the preview page running foreign script with the broker
  capabilities it holds.
- Media failures carry fixed reason tokens the same way, as
  `[onlypreview] event=media-read-failed reason=<token>`.
- Records carry no path, workspace identity, capability token, or file bytes.

Delivery: [onlypreview-image-read-diagnostics-115](../plan/tasks/onlypreview-image-read-diagnostics-115.md).
