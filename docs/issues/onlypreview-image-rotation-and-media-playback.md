# Direct image/media preview needs runtime acceptance and image rotation

Status: fixed in source; owner verification pending

## Confirmed boundary

- `success.wav` is a valid 345,970-byte PCM WAV and current source classifies it as `audio/wav`.
- The supplied payment voucher is a valid 50,983-byte 1322×294 RGBA PNG and current source
  classifies it as `image/png`.
- The hidden preload's bounded prepare/HEAD/GET path returns exact bytes for both files.
- Direct VuePreview already uses native `<audio>/<video controls preload="metadata">`, and its
  supported container catalogs defer actual codec acceptance to Chromium. Unsupported containers
  and runtime codec failures already produce truthful failure states.
- Direct ImagePreview already provides fit, zoom, reset, and pan. It has no rotation state/control.
- A file outside the current Project also depends on Task 098's external-preview authority. The
  personal finance PNG must never be copied into this independent project as a fixture.

Global Search result-preview policy is intentionally separate: non-text image/audio/video results
currently show file information only. This task does not silently add another media streaming lane
to Search.

## Accepted repair

- Keep direct supported audio/video on the existing native Vue player; add representative safe WAV
  and generated-media regression coverage instead of introducing another player or transcoder.
- Add keyboard-accessible 90° clockwise/counter-clockwise rotation controls to direct ImagePreview.
  Rotation is renderer state only and never writes or rewrites the file.
- At 90°/270°, swap the effective image width/height for Fit and pan-clamp calculations. Recompute
  Fit with zero offsets; manual scale remains bounded and offsets reclamp to the rotated footprint.
- Reset returns scale to exactly 100%, translation to zero, and rotation to 0°. File/revision change,
  failure, and unmount clear rotation with the existing image session.
- Preserve supported/unsupported format catalogs, 100 MiB image bound, media Range streaming,
  no-autoplay, `MediaError` truth states, and `find: none`.

## Acceptance

- The representative PCM WAV reaches the native audio player; supported video uses the native video
  player and basic Chromium playback controls. Unsupported codecs/containers fail truthfully.
- Web-compatible admitted images render in direct VuePreview and support fit, zoom, pan, 90° rotate,
  and reset without changing source bytes.
- Rotated fit/pan never loses the image outside reachable bounds and never allocates a transformed
  bitmap/canvas copy.
- Exact external file open remains governed by Task 098; direct image/media tests remain path-safe
  and contain no personal finance artifact.

## Resolution

Implemented by [Task 101](../plan/tasks/onlypreview-image-rotation-media-regression-101.md).
[Independent review 1](../plan/reviews/onlypreview-image-rotation-media-regression-101-1.md) passed;
Ral owns remaining real-app verification with the supplied PNG/WAV and a supported video.
