# OSS release upload times out for large desktop artifacts

Status: fixed

## Report

The macOS ARM `0.0.56` release completed application packaging, signing, notarization, DMG
finalization, and blockmap regeneration, then failed immediately after printing the production OSS
target:

```text
Response timeout for 60000ms
```

No `0.0.56` ZIP, DMG, or blockmap object reached the production prefix. The existing production
manifest remained on `0.0.58`.

## Findings

`scripts/publish.js` sends every artifact through `ali-oss` `client.put()`. The SDK's instance-level
request timeout defaults to 60 seconds, so the first sorted artifact, a roughly 199 MiB ZIP, must be
uploaded as one request within that deadline. The local network did not complete that request in
time. This boundary is after Apple notarization and is unrelated to signing credentials, package
validation, or the generated blockmap.

The failed run also exposed a separate release-order gap: the local artifact version was `0.0.56`
while the production manifest was already `0.0.58`. The existing guard compares only
`version_code`, so it would allow a newer timestamp to replace the manifest with an older semantic
version that Electron's updater cannot treat as an upgrade.

## Resolution contract

- Upload large artifacts with OSS multipart upload, using bounded parallel parts and an explicit
  per-request timeout. Keep small updater metadata on ordinary `put`.
- Emit coarse percentage progress for multipart artifacts without logging credentials or signed
  request data.
- Preserve publication ordering: upload all artifacts first, upload `version_info.json` last, then
  refresh CDN content.
- Reject a local semantic version lower than production, even when its `version_code` is newer.
- Allow an exact semantic-version and `version_code` match so an interrupted publication can be
  retried idempotently. Reject reusing the same semantic version with a different build code.
- Verify the remote object size after each upload before advancing to the next artifact.
- Abort an incomplete multipart upload after terminal failure without masking the original error.
- Require package and dist to identify the exact same release before signing or upload.
- Parse updater metadata and require plain local filenames for every referenced ZIP/DMG/EXE plus
  the corresponding blockmaps before publishing the manifest.

## Verification

- Focused tests cover small-file `put`, large-file multipart options and cleanup, remote-size
  verification, publication ordering, updater artifact completeness, and version/build ordering.
- A source-only dry run must still avoid all OSS writes.
- The repaired production upload must publish a version newer than the existing `0.0.58`; do not
  retry the stale `0.0.56` artifacts.

## Delivery evidence — 2026-08-02

- Production macOS ARM `0.0.60` completed application and DMG signing, Apple notarization,
  stapling, and validation.
- OSS multipart upload completed for the 198,610,272-byte ZIP and 205,206,363-byte DMG without the
  former 60-second whole-file timeout. Both blockmaps and both manifests were uploaded afterward.
- CDN refresh task `33036262702` completed. Public `version_info.json` reports `0.0.60` /
  `260802114545`, `latest-mac.yml` references `Bitterless-0.0.60-arm64-mac.zip`, and public HEAD
  checks return 200 with the expected sizes for all four artifacts.
- Focused release-hook coverage passed 26/26, including multipart cleanup, remote-size checks,
  publication order, artifact completeness, and semantic/build ordering.
