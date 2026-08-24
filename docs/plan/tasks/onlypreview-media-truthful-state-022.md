---
id: onlypreview-media-truthful-state-022
scope: Add an inspectable image viewer, native media players, and truthful bounded failure states
status: implemented; owner verification pending
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
  — #7.2 and #7.4 (implemented task 019 consumes media `find: none`)
- [Preview guards](onlypreview-preview-guards-023.md)
- [OnlyPreview sub-application](../../features/onlypreview.md)

# Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/main/onlypreview/onlyPreviewAsset.registry.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/preview/src/components/ImagePreview/` (new)
- `src/renderer/onlypreview/preview/src/components/MediaPreview/` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewImage.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewImageViewport.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewMedia.service.ts` (new)
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.less`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts`
- `tests/onlypreview/onlyPreviewMediaPreview.test.mjs` (new)
- `tests/onlypreview/onlyPreviewMediaTest.helper.mjs` (new)
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs`
- `docs/design/onlypreview-format-coverage.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-media-truthful-state-022.md`

Do not change the Chrome surface, add codecs/transcoders, or modify unrelated owner work.

# Frontend Design

Keep the image canvas visually quiet and white. A compact translucent control group inside the
Vue content surface provides fit, zoom out, zoom in, and reset; it must not duplicate the Shell file
toolbar. Zoomed images pan by pointer drag with a grab/grabbing cursor, and controls remain keyboard
accessible. Audio/video keep native controls and existing light workbench spacing. Failure copy is
one compact state, not a modal, toast loop, or decorative card stack.

# Delivery

1. Split image and media rendering out of `PreviewSurface.vue` into dedicated components. Keep the
   supported catalogs exactly as image `.png/.jpg/.jpeg/.gif/.webp/.avif/.bmp/.ico/.svg`, audio
   `.mp3/.wav/.ogg/.m4a/.aac/.flac`, and video `.mp4/.webm/.ogv/.mov/.m4v`. Recognize exactly
   `.heic/.heif/.tif/.tiff/.raw` and `.mkv/.avi/.wmv/.flv` as truthful unsupported formats without
   issuing an asset or mounting a decoder/player. Do not infer codec support from these catalogs.
2. Image viewer starts in fit mode, where fit never upscales beyond 100%. Manual zoom uses a 1.25
   factor and is bounded by an effective minimum of `min(0.1, currentFitScale)` and a maximum of `8`;
   the fit-only floor may therefore fall below 10% for a huge image so the complete image still
   fits. Reset means exact 100%, while Fit returns to responsive fit.
   Clamp each centered translation axis to
   `±max(0, (naturalSize * scale - viewportSize) / 2)`. Resize recomputes fit with zero offsets;
   manual/100% mode retains and reclamps offsets. Pan only when at least one axis overflows, using a
   primary pointer with capture/cancel/lost-capture cleanup. The focusable viewport supports arrow-
   key pan, and every visible button has localized label/title plus a truthful disabled bound.
3. Fetch an image completely under its existing 100MiB bound, verify the exact expected response
   length, create a renderer-owned Blob URL, and call an off-DOM `Image.decode()` before mounting the
   live `<img>`. Treat only the mounted exact revision as ready. Empty asset, unreadable/missing
   stream, signature mismatch, and decoder failure are distinct typed terminal states. Abort fetch
   and revoke every created Blob URL exactly once on stale/error/unmount. A failed image never enters
   the visual/accessibility tree. Main revokes the original asset capability after image ready or
   error; the component retains only its renderer-owned Blob URL keyed by selection revision. The
   signature gate admits bounded SVG XML declarations/comments/DOCTYPE before `<svg>`, AAC `ADIF`,
   and plausible MOV/QuickTime `ftyp/moov/mdat/wide/free/skip` first atoms before native decoding.
4. Audio/video first issue `HEAD` against the exact asset and require a successful response with the
   exact expected `Content-Length` and exposed `Accept-Ranges: bytes`; this distinguishes an empty
   or unreadable capability before any player mounts without buffering the media body. Playback then uses
   `<audio controls preload="metadata">` / `<video controls preload="metadata">` directly against
   the Range asset. Map `MediaError.code` 1/2/3/4 to typed aborted/network/decode/source-not-supported
   states and retain a typed load failure when the browser supplies no `MediaError`. A 30-second
   metadata deadline maps a player that emits neither `loadedmetadata` nor `error` to that read
   failure. Do not claim a platform codec exists from its container extension alone.
5. On selection/surface/workspace change and unmount: pause playback, remove listeners, clear `src`,
   call `load()` to release the resource, reset zoom/pan/error, dispose image/media sessions, and
   reject stale events by exact selection revision plus renderer generation. Audio/video asset
   authority is selection-lifetime rather than the legacy 30-minute token TTL, so long playback and
   later seeks remain valid until selection/host/workspace revoke; every other token keeps the TTL.
   The existing bounded registry may still evict its oldest selection token under global pressure.
   A failed file must not leave a stale frame when the next file opens.
6. Keep the explicit image/audio/video adapter identities and `selectedTextAvailable: false` for
   every success/failure state. Implemented task 019 derives and publishes their `find: none`
   capability plus common `Cmd/Ctrl+F` unavailable feedback; 022 itself added no premature find
   field, fake `0/0`, or selected-character metadata.
7. Render file metadata/actions through the existing Shell toolbar. Content failure copy names the
   reason without repeating the toolbar or mounting a second FileActions instance.
8. Add symmetric en/zh labels and update feature/analysis/plan contracts with supported and
   unsupported format/codec boundaries.
9. Main accepts `ready` only while the exact presentation is still `loading`. An image/media error
   may demote the exact revision from `loading` or `ready` to `unavailable`; a delayed ready after an
   error is ignored and cannot resurrect the failed surface. Renderer errors are authorized by the
   active adapter: image accepts only `IMAGE_*`, audio/video only `MEDIA_*`, and an unsupported
   descriptor fallback only the exact effective Main-authored `previewError`; there is no
   cross-family or generic default-allow path.

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
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`
- `git diff --check`
- Electron/Playwright E2E: **do not run**; Ral performs final image/media verification.

# Delivery Evidence

- Focused image/media service, component, classifier, protocol, Region, Store, and source regression:
  110/110 passed. Real Vue SFC/jsdom coverage includes off-DOM image decode, revoke-once and stale
  cleanup, huge-image fit and pan boundaries, pointer/keyboard accessibility, native media HEAD,
  metadata/error/timeout truth, exact teardown order, and old-revision fences.
- [Independent review round 1](../reviews/onlypreview-media-truthful-state-022-1.md) recorded
  **BLOCKED** on renderer-error family authorization. The finding is fixed with an exhaustive adapter
  discriminator. Negative Region behavior tests submit image/media cross-family, document, sheet,
  and generic errors in both loading and ready states and prove rejection leaves presentation,
  broadcasts, and asset revocation unchanged. Unsupported descriptor fallbacks reject same-kind and
  cross-family alternatives while accepting only exact empty/signature/oversize or mapped-codec
  truth.
- Full `node --test tests/onlypreview/*.test.mjs`: 299/299 passed.
- `yarn typecheck:node` and `yarn check:renderer-i18n`: passed.
- `yarn typecheck:web`: the existing repository baseline remains at 76 diagnostics in Connector,
  Poker, Home, Maestro, Omni, and shared path code; no OnlyPreview diagnostic was produced.
- Focused ESLint and Prettier for the exact Task 022 source/test/doc set: passed. Both new test files
  remain below the 800-line TS/JS limit (794 and 112 lines after formatting).
- Safe source build passed through
  `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`.
  Output audit found the image/native-media code in the OnlyPreview Vue chunk and no added codec,
  transcoder, waveform, or player engine chunk; existing ExcelJS Worker and dynamic `docx-preview`
  chunks remain isolated.
- `git diff --check`: passed. Electron/Playwright E2E and the real app were intentionally not run;
  Ral retains final image/media runtime and visual verification.
- [Independent review round 2](../reviews/onlypreview-media-truthful-state-022-2.md) recorded
  **PASS**, with no P0, P1, P2, or non-blocking finding remaining.
- Task 025 adds one Store-owned metadata view model and one real `PreviewSurface` metadata block for
  direct unsupported plus image/media/Office/parser/signature/empty/size failures. Real Store/SFC
  behavior verifies the exact localized reason, file name, type, size, and modified time while the
  Shell toolbar remains the sole `FileActions` owner; the focused metadata pass is 43/43 and the
  combined OnlyPreview suite is 318/318.
- The ledger is `implemented; owner verification pending`; Ral retains final real-app image/media
  runtime and visual verification.
