# Preview macOS ARM publish does not cut a new version

Status: fixed in source; owner publication verification pending

## Observed behavior

Running `yarn publish_preview:mac_arm` builds and uploads the current package identity but does not
increment its semantic patch version. Repeating the ordinary Preview publish therefore keeps local
`0.0.84`; once that identity is already installed/published, the updater has no newer semantic
version to offer.

This is an operator-workflow regression introduced when per-platform `--bump` flags were removed in
favor of a separate `yarn release:cut`. The cross-channel uniqueness guard is correct, but the
macOS ARM command no longer matches Ral's expected one-step Preview release workflow.

## Required behavior

- `yarn publish_preview` and its macOS ARM target cut exactly one new package patch/version code
  before audit, build, signing, and publication.
- macOS ARM is the canonical one-step Preview cut command. Preview macOS Intel and Windows publish
  the already-cut identity and do not increment it again, so one release still spans platforms.
- Stable and development publishers keep their current version behavior.
- Cross-channel version/version-code reuse checks remain unchanged.
- Merely implementing or testing the fix must not run the patch, build, sign, notarize, upload, or
  refresh a CDN. The current local `0.0.84` stays unchanged until Ral runs the publish command.

## Acceptance

- Package-script regression proves macOS ARM Preview has exactly one `--bump` before `--build`.
- Preview Intel/Windows and all Stable/development platform publishers remain non-bumping.
- `release:cut` remains available for an explicit multi-platform/non-ARM cut.
- Existing release ordering and cross-channel identity tests pass.

Implementation task:
[release-preview-mac-arm-auto-cut-115](../plan/tasks/release-preview-mac-arm-auto-cut-115.md).

## Delivery

- `publish_preview:mac_arm` now passes exactly one `--bump` before `--build`; the generic
  `publish_preview` alias continues to delegate to it.
- Preview Intel/Windows and all Stable/development publishers remain non-bumping, while
  `release:cut` remains available.
- The implementation did not execute patch/build/publish: package identity remains
  `0.0.84 / 260901164356` until Ral runs the command.
- Release-hook tests passed 37/37, syntax/diff checks passed, and
  [independent review 1](../plan/reviews/release-preview-mac-arm-auto-cut-115-1.md) found no P0-P3
  issue.
