---
id: release-oss-multipart-upload-006
scope: resilient OSS publication for large desktop artifacts and semantic release ordering
status: done
depends-on: [release-local-fast-publish-005]
---

# OSS multipart release upload

## Objective

Prevent large ZIP and DMG publication from failing at the `ali-oss` 60-second whole-file request
deadline, and stop a locally stale semantic version from replacing a newer production manifest.

## Context

- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/oss-release-large-artifact-timeout.md`
- `scripts/publish.js`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Implementation contract

- Select multipart upload for artifacts at or above a fixed large-file threshold.
- Use explicit part size, parallelism, and per-request timeout values suitable for approximately
  200 MiB desktop artifacts.
- Log stable coarse progress and verify the uploaded object's content length before reporting
  success.
- Keep small metadata files on `put` and keep `version_info.json` as the final uploaded object.
- Abort failed multipart transactions and retain the original upload error if cleanup also fails.
- Compare both package `version` and `version_code` against the current remote manifest before any
  build, signing, or upload work.
- Require package and `dist/version_info.json` to identify the exact same release before signing.
- Reject updater metadata that references a URL, directory, absent artifact, wrong version, or an
  installer without its required blockmap.
- Reject semantic downgrades and same-version/different-build reuse; permit exact retries and
  strictly newer semantic versions with strictly newer build codes.

## Path

- `docs/INDEX.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/issues/oss-release-large-artifact-timeout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/release-oss-multipart-upload-006.md`
- `scripts/publish.js`
- `scripts/sqlite-migrations/release-hook.test.mjs`

## Verification

- Run the focused release-hook tests without signing, notarizing, or uploading.
- Run `node scripts/publish.js --env prod --platform mac_arm --dry-run` against existing artifacts.
- Publish only after preparing a semantic version newer than production `0.0.58`, then verify each
  artifact, updater metadata, and the public manifest.

## Completion evidence — 2026-08-02

- `node --test scripts/sqlite-migrations/release-hook.test.mjs` passed 26/26 and the production
  preflight accepted the exact idempotent `0.0.60 / 260802114545` release identity.
- The full macOS ARM production flow signed and notarized both the application and DMG, then
  multipart-uploaded the 198,610,272-byte ZIP and 205,206,363-byte DMG with visible progress and
  remote-size verification.
- Artifacts were uploaded before `latest-mac.yml` and `version_info.json`; CDN refresh completed
  afterward. Public manifest and HEAD checks confirm `0.0.60` and every referenced artifact.
