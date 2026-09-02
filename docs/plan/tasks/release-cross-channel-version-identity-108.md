---
id: release-cross-channel-version-identity-108
scope: make a published release identity unique across channels and cover every platform of one release with one version
status: implemented; owner release verification pending
depends-on: [release-dev-dist-isolation-105, release-preview-version-log-008]
verify: node --test scripts/sqlite-migrations/release-hook.test.mjs && node --check scripts/publish.js && node --check scripts/release/releaseChannel.cjs && git diff --check
---

# Make release identity unique across channels

## Objective

Stop Stable and Preview from publishing different binaries under the same `version` and
`version_code`, and stop one release from minting a new version per platform, without weakening any
existing same-channel publication gate.

## Context

- `docs/issues/cross-channel-release-version-identity-collision.md`
- `docs/features/desktop-release-channels.md`
- `docs/plan/tasks/release-dev-dist-isolation-105.md`
- `docs/plan/tasks/release-preview-version-log-008.md`

## Path

- `scripts/publish.js`
- `scripts/release/releaseChannel.cjs`
- `package.json` scripts block
- `scripts/sqlite-migrations/release-hook.test.mjs`
- feature, issue, plan, and index documents

## Contract

- Add a cross-channel identity guard to publication. Before upload, read the other two channels'
  `version_info.json` for the **same** platform and refuse when either already carries the local
  `version_code`, or already carries the local `version` under a different `version_code`.
- Resolve the other channels from `releaseChannelConfigs` — do not hard-code a second channel list.
  The manifest object key is built from the same `prefix`/`env`/`platform` shape publication already
  uses, so the guard and the upload target can never diverge.
- Fail closed on transport errors and open on absence: `NoSuchKey`/`404` means "not published" and
  is allowed, exactly as `assertNoRemoteDowngrade()` already treats it. Reuse that error
  classification rather than writing a second one.
- Run the guard in the same place as the existing preflight so `--preflight-only` and `--dry-run`
  keep their current meaning: `--preflight-only` reports the verdict and exits before any build,
  `--dry-run` performs no OSS writes.
- Remove `--bump` from `publish_preview:mac_arm`, `publish_preview:mac_intel`, and
  `publish_preview:win`. Add `release:cut` as `node scripts/patch.js`, the single documented bump
  entrypoint. Keep `fast_publish:mac_arm` as an explicit single-platform cut-and-publish that still
  performs exactly one build.
- Do not change `assertReleaseOrder()` policy or its messages, `patch.js` bump arithmetic, channel
  directories, artifact discovery, upload order, CDN refresh, or credentials.
- Do not rewrite, relabel, re-upload, or delete any published artifact. Stable `0.0.78` and Preview
  `0.0.82` remain untouched.
- Do not modify or discard unrelated dirty-worktree changes, including the Electron/SQLite pin.

## Verification

- Fixture: another channel's manifest carries the local `version_code` → refused.
- Fixture: another channel's manifest carries the local `version` under a different `version_code`
  → refused.
- Fixture: both other channels return `NoSuchKey` → allowed, and the fake client is asserted to have
  been asked for the exact expected object keys.
- Fixture: another channel's read fails with a transport error → refused.
- Regression: the existing same-channel downgrade, version-reuse, and version_code-reuse rejections
  keep their current messages.
- Package-script guard: no `publish*:*` alias carries `--bump`; `release:cut` exists;
  `fast_publish:mac_arm` performs one build.
- `node --check` on both modified scripts and `git diff --check`.
- Do not invoke package builds, signing, notarization, publication, network operations, Electron,
  Playwright, or E2E. Ral owns the next release run.

## Delivery

- Added `assertNoCrossChannelIdentityReuse()` to `scripts/publish.js`. It iterates the other
  `releaseChannelConfigs` entries, reads `${prefix}/<channel>/<platform>/version_info.json`, and
  refuses a reused `version_code` or a reused `version` with an explicit cross-channel message.
- Extracted `isMissingRemoteObject()` so absence/transport classification is shared with
  `assertNoRemoteDowngrade()` instead of duplicated.
- Wired the guard into both existing gates: the preflight before `--preflight-only` returns, and the
  post-build check against `version_info.json`. `--dry-run` still performs no OSS reads or writes.
- Removed `--bump` from the three Preview publishers, added `release:cut`, and left
  `fast_publish:mac_arm` as the single-platform cut-and-publish path.
- Left `assertReleaseOrder()`, `patch.js`, channel directories, artifact discovery, upload order,
  CDN refresh, credentials, and every published artifact untouched.

## Verification result

- `node --test scripts/sqlite-migrations/release-hook.test.mjs` — 37/37, including cross-channel
  version_code reuse, cross-channel version reuse, allowed-when-absent with exact requested keys and
  success log, refused-on-transport-failure, the two-call publisher ordering guard, and the
  no-publisher-mints-a-version alias guard.
- `node --test scripts/environment/runtimeProfile.test.mjs` — 10/10.
- `node --check scripts/publish.js`, `node --check scripts/release/releaseChannel.cjs`, and
  `git diff --check` passed.
- ESLint on the touched files reports only the pre-existing `no-require-imports` and
  `explicit-function-return-type` violations that `scripts/**/*.cjs` and `scripts/publish.js`
  already carry file-wide; no new class of finding was introduced and none was suppressed.
- No build, signing, notarization, publication, network operation, Electron, or E2E ran.

## Owner Verification

- Cut one release with `yarn release:cut`, publish it to two platforms of the same channel, and
  confirm both feeds advertise the identical `version` and `version_code`.
- Attempt a Stable publication without a fresh cut while the Preview feed holds that identity, and
  confirm it is refused rather than silently accepted.
