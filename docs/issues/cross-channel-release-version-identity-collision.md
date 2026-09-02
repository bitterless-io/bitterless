# Stable and Preview can publish the same release identity

Status: implemented; owner release verification pending

## Observed behavior

`package.json` carries a single `_version` and a single `version_code` for all three release
channels. `scripts/before.js` copies `_version` into `version` for whichever channel is selected,
and `scripts/patch.js` bumps both fields in place. Neither is channel-aware.

Preview publication always bumps that shared counter:

```text
publish_preview:mac_arm    … node scripts/publish.js --env preview --platform mac_arm   --bump --build
publish_preview:mac_intel  … node scripts/publish.js --env preview --platform mac_intel --bump --build
publish_preview:win        … node scripts/publish.js --env preview --platform win64     --bump --build
```

Stable publication does not:

```text
publish:mac_arm    node scripts/publish.js --env prod --platform mac_arm   --build
publish:mac_intel  node scripts/publish.js --env prod --platform mac_intel --build
publish:win        node scripts/publish.js --env prod --platform win64     --build
```

Only `fast_publish:mac_arm` runs `scripts/patch.js` before delegating to `publish:mac_arm`.

`assertNoRemoteDowngrade()` reads only the selected channel's own remote manifest, so it cannot
observe an identity that another channel already published.

Two consequences follow.

1. **Cross-channel identity collision.** Observed on 2026-09-01: the production feed holds
   `0.0.78 / 260820190455`, the Preview feed holds `0.0.82 / 260901114002`, and the working tree
   holds `0.0.84 / 260901164356`, which the in-flight Preview publication is consuming. Running
   `yarn publish:mac_arm` afterwards, without a separate bump, publishes a **different** Stable
   binary under the **same** `version` and the **same** `version_code` as Preview `0.0.84`. The
   remote order check passes, because the production feed is still at `0.0.78`.
2. **Per-platform bump.** `--bump` runs once per platform publisher, so publishing one Preview
   release to macOS ARM, macOS Intel, and Windows mints three different versions. The three
   platform feeds of a single release can never advertise the same `version` / `version_code`.

This does not break automatic updates. Each channel/platform feed is compared only against itself,
and the currently published Preview feed is internally consistent. The damage is to build identity:
`version_code` is defined as the unique local build timestamp, and manifests, application logs, the
Settings Log ledger, and the Ops inventory all use it to name one specific binary.

## Required behavior

- A published release identity (`version` + `version_code`) denotes exactly one binary lineage. No
  two channels may publish the same `version_code`, and no two channels may publish the same
  `version`.
- One release version covers every platform of that release. Publishing the same release to a
  second platform must not mint a new `version` or a new `version_code`.
- Publication fails closed when it cannot prove the identity is unused. A `404`/`NoSuchKey` from
  another channel's manifest means "not published" and is allowed; a transport failure is refused,
  matching the existing `assertNoRemoteDowngrade()` behavior.
- The existing same-channel order guards in `assertReleaseOrder()` stay exactly as they are.
- No already-published artifact is rewritten, relabelled, re-uploaded, or deleted. The current
  Stable `0.0.78` and Preview `0.0.82` feeds are left untouched.

## Operator-workflow decision

The original delivery removed `--bump` from every platform publisher and required an explicit
`yarn release:cut`. Ral subsequently restored the expected one-step Preview workflow on 2026-09-02:
macOS ARM is the canonical Preview cut-and-publish command and increments exactly once; Preview
Intel/Windows reuse that already-cut identity. `release:cut` remains available when a release must
start from another platform. `fast_publish:mac_arm` retains its existing Stable cut behavior.

Forgetting the cut is not silent: republishing an identity that the same channel already holds is
still refused by `assertReleaseOrder()` with the existing version-reuse message.

## Acceptance

- A pure Node fixture proves publication refuses a `version_code` that another channel's manifest
  for the same platform already carries.
- A fixture proves publication refuses a `version` that another channel already published under a
  different `version_code`.
- A fixture proves `NoSuchKey` from another channel is allowed and a transport error is refused.
- Package-script tests prove only the canonical `publish_preview:mac_arm` carries `--bump`, Preview
  Intel/Windows and Stable/development publishers do not, `release:cut` exists, and
  `fast_publish:mac_arm` still performs exactly one build.
- Same-channel downgrade, version-reuse, and version_code-reuse rejections keep their current
  messages and remain covered.
- No build, signing, notarization, upload, CDN refresh, Electron, or E2E runs during verification.

Implementation task:
[release-cross-channel-version-identity-108](../plan/tasks/release-cross-channel-version-identity-108.md).

## Delivery

- `assertNoCrossChannelIdentityReuse()` reads the other two channels' manifest for the same platform
  before upload and refuses a reused `version_code` or a reused `version`. Absence is allowed, a
  transport failure is refused, and both checks reuse the single `isMissingRemoteObject()`
  classification now shared with `assertNoRemoteDowngrade()`.
- The guard runs in both existing publication gates: the preflight, so `--preflight-only` reports it
  before any build, and again after the build against the produced `version_info.json`.
- The initial delivery removed every Preview `--bump`; follow-up task 115 restores it only on the
  canonical macOS ARM Preview publisher. Intel/Windows reuse that identity, while `yarn release:cut`
  remains the explicit alternative and `fast_publish:mac_arm` keeps its Stable cut.
- Same-channel order policy, messages, artifact discovery, upload order, CDN refresh, and
  credentials are unchanged, and no published artifact was touched.
- Release-hook suite passed 37/37, including four new guard fixtures and the publisher-ordering
  guard; `node --check` accepted both modified scripts and `git diff --check` passed.
- No build, signing, notarization, upload, CDN refresh, Electron, or E2E ran.
