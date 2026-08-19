---
id: onlypreview-media-truthful-state-022
scope: Replace silent image/media failures with truthful, actionable preview states
status: pending
depends-on: [onlypreview-preview-header-merge-018, onlypreview-preview-guards-023]
---

# Objective

Make every non-renderable image, audio, and video case state its reason instead of showing a broken
image, a black frame, or a dead player. Keep native decoding for everything Chromium already plays,
list the unsupported containers/codecs explicitly, and give each failure the file metadata plus the
existing external-open actions. No transcoding is introduced.

# Context

- [OnlyPreview preview format coverage](../../design/onlypreview-format-coverage.md) — #5 image/media
  decision, #6 truthful states, PQ-C
- [OnlyPreview sub-application](../../features/onlypreview.md) — classification, state/error, and
  layout contracts

# Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`

# Delivery

1. Keep the current image/audio/video extension sets and native elements. Do not add containers or
   codecs Chromium cannot decode (`.mkv`, `.avi`, `.wmv`, `.flv`, ProRes-in-`.mov`); they remain
   unsupported and must not present a player.
2. Replace the generic media error path with a typed state carrying the cause: decode failure,
   unsupported codec (`MediaError.code`), missing/unreadable asset, or empty file. Render file name,
   type, size, modified time, and the existing file actions.
3. Give images the same treatment: a decode failure renders the truthful state instead of a broken
   image element.
4. Report HEIC/HEIF/TIFF/RAW as recognized-but-not-renderable with the same state (transcoding stays
   out of scope per design PQ-C).
4a. Do not duplicate the extension/content mismatch state: task 023 owns `SIGNATURE_MISMATCH` copy and
   rendering; this task only covers decode/codec failures for files whose signature matched.
5. Keep the selected-grapheme count contract unchanged: media states report zero and never arm
   counting.
6. Add localized copy in both `en` and `zh`, and update the feature doc's state/error and layout
   contracts in the same delivery.

# Acceptance

- A truncated PNG, an `.mkv`, and a HEIC file each render a distinct, localized, actionable state
  naming the reason; none shows a player or a broken image.
- Every currently playable audio and video format still plays with unchanged controls and preload
  behavior.
- The Shell status rail shows no character count for any media or failure state.
- Switching from a failed media file to a working one clears the failure state without a stale frame.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- Focused ESLint for the changed OnlyPreview TypeScript/Vue files
- `yarn build`
- Electron E2E (`yarn test:e2e:onlypreview`): owner-run on request. Per the overmind rule, agents must
  not launch Electron end-to-end suites unprompted; report them as not run instead.
