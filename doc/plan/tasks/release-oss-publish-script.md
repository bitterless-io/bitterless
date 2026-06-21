---
id: release-oss-publish-script
scope: release
status: done
depends-on: []
---

# Release OSS Publish Script

## Objective

Make Bitterless able to package release builds and publish updater artifacts to OSS from scripts inside the Bitterless repo, while keeping credentials outside the submodule.

## Constraints

- Do not copy secrets into `projects/bitterless`.
- Read OSS publish credentials from `/Users/ral/Documents/projects/overmind/areas/keychain/bitterless/publish.env`.
- Keep signing credentials in the overmind keychain too; use local signing files only as an optional override.
- Make macOS signing robust when an old `CSC_LINK` points to a missing local file by falling back to the keychain certificate.
- Preserve existing `publish:*` script behavior as upload-only so existing `fast_publish:*` commands do not build twice.

## Plan

- Add `scripts/publish.js`.
- Add a `.gitignore` exception so `scripts/publish.js` is tracked even though old root-level `publish.js` files remain ignored.
- Support `--env dev|prod`, `--platform mac_arm|mac_intel|win64`, `--build`, `--dry-run`, and `--env-file`.
- Upload platform artifacts to `bitterless/distro/<env>/<platform>/`.
- Upload `version_info.json` last and include the public `downloadUrl` expected by the updater.
- For macOS artifacts, sign, notarize, and staple the DMG before upload, then regenerate the DMG blockmap and update `latest-mac.yml`.
- Refresh the public CDN directory after upload so `latest-mac.yml` and `version_info.json` are visible through `assets.terncloud.com`.
- Update `scripts/signedBuild.js` to read keychain signing env as a fallback.
- Add package aliases for build+publish.

## Verification

- `node scripts/publish.js --help`
- `node scripts/publish.js --env prod --platform mac_arm --dry-run`
- `git diff --check`
- `yarn build`
- `xcrun stapler validate dist/Bitterless-0.0.31.dmg`
- `spctl -a -vvv -t open --context context:primary-signature dist/Bitterless-0.0.31.dmg`
- `curl -fsSL https://assets.terncloud.com/bitterless/distro/prod/mac_arm/latest-mac.yml`

## Result

- Added `scripts/publish.js`.
- Added a `.gitignore` exception for `scripts/publish.js`.
- Reads OSS credentials from `/Users/ral/Documents/projects/overmind/areas/keychain/bitterless/publish.env` by default.
- Upload-only commands keep using existing `publish:*` aliases.
- Build-and-publish commands are available as `release:*` and `release_dev:*`.
- `version_info.json` is uploaded last and includes the updater `downloadUrl`.
- macOS publish now signs, notarizes, and staples the DMG before upload, regenerates the DMG blockmap, and updates `latest-mac.yml`.
- Publish now refreshes the public CDN directory after upload; use `--no-cdn-refresh` to skip it.
- `scripts/signedBuild.js` now falls back to `/Users/ral/Documents/projects/overmind/areas/keychain/bitterless/signing.env`.
- If `CSC_LINK` points to a missing file, `scripts/signedBuild.js` now falls back to `/Users/ral/Documents/projects/overmind/areas/keychain/bitterless/Certificates.p12`.
- `scripts/signedBuild.js` now prefers the local `node_modules/.bin/electron-builder` binary so direct `node scripts/publish.js --build` runs do not require a global `electron-builder`.
- `scripts/notarize.js` now also reads the keychain signing env fallback and redacts the app-specific password in printed manual commands.
- Verified with help output, syntax checks, dry-run upload planning, `git diff --check`, and `yarn build`.
