---
id: release-notarization-retry-004
scope: independently rerunnable macOS application and DMG notarization with live network retry logs
status: implementation in progress
depends-on: [release-fast-publish-dependency-sync-003]
---

# macOS notarization retry and progress

## Objective

Keep `yarn fast_publish:mac_arm` on Apple's default S3-accelerated notarization route while making
transient application and DMG upload failures visible, bounded, and independently retryable.

## Context

- `docs/issues/macos-dmg-notarization-upload-timeout.md`
- `docs/features/sqlite-migration-release-gate.md`
- `electron-builder.tmp.yml`
- `scripts/notarize.js`
- `scripts/publish.js`
- `scripts/sqlite-migrations/release-hook.test.mjs`
- `package.json`

## Implementation contract

- Keep Electron Builder responsible for application signing but disable its built-in notarization
  call.
- Register `scripts/notarize.js` as the `afterSign` hook in `electron-builder.tmp.yml`; do not edit
  the generated `electron-builder.yml`.
- Recreate the signed application ZIP, submit it, wait for acceptance, then staple and validate the
  `.app` before Electron Builder creates ZIP or DMG artifacts.
- Share one submit/wait implementation with DMG publication, then staple and validate the DMG before
  regenerating metadata or uploading.
- Use Apple's default S3 acceleration. Never pass `--no-s3-acceleration`.
- Stream timestamped progress for each submit/wait attempt, submission ID, retry delay, final
  status, staple, and validation step without logging credentials.
- Submit and wait are separate operations. A wait retry reuses the existing submission ID; it does
  not upload the artifact again.
- Retry only recognized transient network transport failures with bounded backoff. Authentication,
  preflight, malformed-package, `Invalid`, and `Rejected` outcomes fail immediately.
- Expose application-only macOS ARM/x64 retry commands for an already signed bundle. Keep
  `fast_publish:mac_arm` unchanged so its normal build automatically invokes the hook.

## Path

- `docs/INDEX.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/macos-dmg-notarization-upload-timeout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/release-notarization-retry-004.md`
- `electron-builder.tmp.yml`
- `package.json`
- `scripts/notarize.js`
- `scripts/publish.js`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Verification

- Independent source review verifies ordering, retry classification, credential redaction, stale-ZIP
  prevention, application/DMG staple validation, and generated-config exclusion.
- Per owner request, do not run tests, signing, notarization, packaging, upload, publication, or
  `yarn fast_publish:mac_arm`.
- The owner performs the release-path verification with `yarn fast_publish:mac_arm`.
