---
id: onlypreview-image-rotation-media-regression-101
scope: Read-only image rotation plus representative direct native media playback regressions
status: implemented; owner verification pending
depends-on:
  - onlypreview-media-truthful-state-022
  - onlypreview-external-file-preview-098
verify: focused image/media/preload Node tests, web typecheck, i18n, lint, build, and git diff check; no Electron/E2E
---

# Rotate images and lock direct media playback behavior

## Objective

Add non-destructive 90° rotation to the direct Vue ImagePreview and prove that valid Chromium-
supported audio/video files continue through the existing native players.

## Paths

- `src/renderer/onlypreview/preview/src/components/ImagePreview/ImagePreview.vue`
- `src/renderer/onlypreview/preview/src/components/ImagePreview/ImagePreview.less`
- `src/renderer/onlypreview/preview/src/onlyPreviewImageViewport.service.ts`
- image/media i18n only if new visible labels require it
- focused image viewport/media/source tests

## Contract

1. Add rotate-left and rotate-right icon buttons to the existing compact image controls. Each click
   changes renderer-only rotation by 90°; no file mutation, canvas re-encode, or new asset read.
2. Fit and pan use rotated effective dimensions. Quarter-turn rotations swap natural width/height;
   half-turn rotation does not. Fit resets offsets; manual zoom and resize preserve then reclamp.
3. Reset restores rotation 0°, scale 100%, and zero offsets. Selection/unmount/error uses the same
   complete reset and Blob/session disposal fence.
4. Preserve the existing direct `<audio>`/`<video controls preload="metadata">` implementation,
   Range asset, no autoplay, supported container catalog, runtime codec truth, timeout, and teardown.
5. Add safe representative regression coverage for PCM WAV/native controls and generated compatible
   image inputs. Never copy the supplied personal finance PNG into the repository.
6. Do not expand Global Search result preview to non-text media in this task.

## Verification

- Image viewport unit/SFC behavior for all four rotations, fit, zoom, resize, pan clamp, reset,
  revision teardown, accessible labels, and absence of file mutation APIs.
- Media component/source/preload tests proving supported audio/video mount native controls and
  unsupported/runtime failures remain truthful.
- Relevant typecheck, i18n, focused lint, `yarn build`, and `git diff --check`.
- No Electron/Playwright/E2E; Ral owns final visual/playback acceptance.

## Delivery

Implemented on 2026-09-01. ImagePreview now owns renderer-only left/right quarter-turn state;
rotated effective dimensions drive Fit, zoom, resize, and pan clamps, while Reset, error, and
teardown restore `0° / 100% / zero offset`. The existing native Range-backed audio/video players
remain unchanged, with safe generated image/PCM WAV and repository WAV regressions added.

[Independent review 1](../reviews/onlypreview-image-rotation-media-regression-101-1.md) passed with
no P0-P3 finding. Ral owns remaining real-app visual, zoom/rotate, and Chromium playback acceptance.
