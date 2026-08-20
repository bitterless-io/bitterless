---
id: onlypreview-media-truthful-state-022
scope: Add an inspectable image viewer, native media players, and truthful bounded failure states
status: pending
depends-on: [onlypreview-docx-render-021]
---

# Objective

Finish the `vuePreviewView` image/audio/video experience. Images use a dedicated read-only viewer
with fit, zoom, reset, and pan. Audio/video use dedicated components around Chromium's native
controls. Supported bytes render/play; empty, unreadable, decode, codec, and recognized-but-
unsupported cases become explicit localized states without a broken image, black frame, or dead
player. No transcoding, thumbnail generation, waveform, OCR, or media text search is introduced.

# Context

- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md) — #5 and #6
- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
  — #7.2 and #7.4 (`find: none`)
- [Preview guards](onlypreview-preview-guards-023.md)
- [OnlyPreview sub-application](../../features/onlypreview.md)

# Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/preview/src/components/ImagePreview/` (new)
- `src/renderer/onlypreview/preview/src/components/MediaPreview/` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewImageViewport.service.ts` (new)
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.less`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/onlyPreviewMediaPreview.test.mjs` (new)
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

Do not change the Chrome surface, add codecs/transcoders, or modify unrelated owner work.

# Frontend Design

Keep the image canvas visually quiet and white. A compact translucent control group inside the
Vue content surface provides fit, zoom out, zoom in, and reset; it must not duplicate the Shell file
toolbar. Zoomed images pan by pointer drag with a grab/grabbing cursor, and controls remain keyboard
accessible. Audio/video keep native controls and existing light workbench spacing. Failure copy is
one compact state, not a modal, toast loop, or decorative card stack.

# Delivery

1. Split image and media rendering out of `PreviewSurface.vue` into dedicated components. Keep the
   currently reviewed Chromium-decodable extension/container sets and finite revision-bound asset
   stream. Recognize HEIC/HEIF/TIFF/RAW and unsupported media containers as truthful unsupported
   kinds without creating a decoder/player.
2. Image viewer starts in fit mode, supports bounded zoom out/in, 100% reset, fit-to-window, and
   pointer pan only when content exceeds the viewport. Clamp translation so the image cannot be lost
   offscreen; resize recomputes fit without stale offsets. Keyboard and accessible labels mirror
   every visible action.
3. Treat successful image load/decode as ready. Empty asset, unreadable/missing stream, signature
   mismatch, and decoder failure are distinct terminal states. Remove the failed `<img>` from the
   visual/accessibility tree rather than leaving a broken icon.
4. Audio/video use `<audio controls preload="metadata">` / `<video controls preload="metadata">`.
   Map `MediaError.code` to aborted/network/decode/source-not-supported states while distinguishing
   empty/unreadable assets before player readiness. Do not claim a platform codec exists from its
   container extension alone.
5. On selection/surface/workspace change and unmount: pause playback, clear `src`, call `load()` to
   release the resource, clear media/image events, reset zoom/pan/error, revoke the asset capability,
   and reject stale events by exact selection revision. A failed file must not leave a stale frame
   when the next file opens.
6. Publish `find: none` for image/audio/video and all their failure states. `Cmd/Ctrl+F` later gives
   the common lightweight unavailable feedback; no fake `0/0` and no selected-character metadata.
7. Render file metadata/actions through the existing Shell toolbar. Content failure copy names the
   reason without repeating the toolbar or mounting a second FileActions instance.
8. Add symmetric en/zh labels and update feature/analysis/plan contracts with supported and
   unsupported format/codec boundaries.

# Acceptance

- A supported image fits initially, zooms in/out, resets, and pans within clamped bounds; controls
  are accessible and do not change the Shell toolbar height.
- A truncated PNG, empty image, unreadable asset, and HEIC each produce the correct compact truthful
  state with no broken image element.
- Reviewed MP3/WAV/OGG/M4A/AAC/FLAC and MP4/WebM/OGV/MOV/M4V use native controls when Chromium can
  decode them. Decode/source/network/empty failures identify the real category and never present a
  permanently inert player as success.
- MKV/AVI/WMV/FLV and recognized unsupported image formats do not mount a player/decoder or trigger
  dynamic engine loading.
- Switching away pauses/releases media, clears the frame and all zoom/error state, and ignores stale
  events. Character count/current-file find remain unavailable for every media state.

# Verification

- Focused image viewport, media error mapping, lifecycle, and source tests
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` (separate unrelated baseline failures)
- `yarn check:renderer-i18n`
- Focused ESLint for changed OnlyPreview files
- `yarn build`
- `git diff --check`
- Electron/Playwright E2E: **do not run**; Ral performs final image/media verification.
