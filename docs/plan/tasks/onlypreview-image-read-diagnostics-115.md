---
id: onlypreview-image-read-diagnostics-115
scope: render images directly from the asset element, keep the token for the selection, and make every asset rejection nameable
status: implemented; owner verification pending
depends-on: [onlypreview-media-truthful-state-022, onlypreview-action-diagnostics-103]
---

# Image Read Path

## Objective

Make an image preview load, and make any remaining failure nameable.

Issue: [`onlypreview-image-read-failure-is-unnamed.md`](../../issues/onlypreview-image-read-failure-is-unnamed.md).

## Required behavior

1. `createOnlyPreviewImageRender(assetUrl, size, mimeType)` replaces `OnlyPreviewImageSession`. It
   validates input, rejects an empty file with `IMAGE_EMPTY`, and returns `{ src: assetUrl }`. It
   performs no I/O.
2. `ImagePreview.vue` binds `content.src` on the `<img>` and takes the intrinsic size from the
   element on `load`, then fits. Every viewport computation is fenced on that size existing —
   `assertDimensions` rejects a non-positive natural width, so an unfenced computation would throw
   during the first render.
3. An element `error` reports `IMAGE_READ_FAILED`; a `load` with no decodable frame goes through
   the same path. `IMAGE_DECODE_FAILED` no longer originates in the component.
4. Image, audio and video assets are all issued with `lifetime: 'selection'`, and
   `onlyPreviewAdapterUsesOneShotAsset` keeps only `drawio-viewer`. The `<img>` element holds the
   URL, so retiring the token on ready broke every repeat request.
5. `Content-Length` is trusted only when present, in the media preflight. `Accept-Ranges: bytes`
   stays required.
6. Every asset response carries open CORS headers, including 400/404/405/413. `OPTIONS` returns
   204. Each rejection is recorded as `[onlypreview] event=asset-rejected reason=<token>
   status=<n>`, with a sanitized cause for the caught-exception case.
7. The preview and shell CSPs open every content-loading directive; `script-src` stays `'self'`.
8. Records carry no path, workspace identity, capability token, or file bytes.

## Verification

- `tests/onlypreview/*.test.mjs`: 649 tests, 642 pass. The 7 failures are pre-existing and belong to
  another session's in-flight work — the `GlobalSearchWorkspace` mount shape, the shell Project
  filter, the find UI source guard, the `onlyPreviewPreviewRegion.service.ts` 800-line budget, and
  the 3-argument `onlyPreviewGlobalSearchWindowService.updateBounds` signature. Each was confirmed
  against `git show HEAD:` or against files this change does not touch.
- `yarn build` succeeds. `vue-tsc --noEmit` and `tsc --noEmit -p tsconfig.node.json` report no error
  in any OnlyPreview file. Note that `yarn typecheck:node` runs `tsc --noCheck` and therefore does
  not type-check.
- Electron E2E is excluded; the owner verifies by previewing a PNG and an audio file.
