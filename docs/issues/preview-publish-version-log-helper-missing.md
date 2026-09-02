# Preview publication crashes after release-order validation

Status: implemented; owner publication completion pending

## Observed behavior

`yarn publish_preview:mac_arm` completes the SQLite migration audit and remote release-order check,
then exits with `[publish.js] releaseVersionCode is not defined`.

The Preview release refactor moved the canonical `releaseVersionCode()` normalizer into
`scripts/release/releaseChannel.cjs`, but did not export or import it. The publisher's successful
remote-version log still calls that helper, so the branch fails only when a remote manifest exists
and its ordering is valid. The first Preview publication's missing-manifest path did not exercise
this branch.

The failed command already completed its requested version bump to `0.0.80` with version code
`260901100018`. It stopped before build, signing, notarization, upload, or CDN refresh.

## Required behavior

- Keep one release-version-code normalizer in the release-channel helper and import it explicitly
  wherever publication uses it.
- Exercise the existing-remote, valid-order branch with an in-memory fake OSS client so an undefined
  helper or incorrect object key fails before a real release.
- Preserve the already-bumped `0.0.80 / 260901100018` release identity while implementing and
  verifying the repair; the repair itself must not run another bump.
- Do not build, sign, notarize, upload, refresh the CDN, or access the network while verifying this
  repair.

## Acceptance

- A focused pure Node regression executes `assertNoRemoteDowngrade()` with a valid remote manifest,
  reads the exact `<prefix>/version_info.json` key, and completes the success log without throwing.
- Existing release-order, upload-order, migration-hook, and channel tests remain green.
- `node --check` accepts both release scripts and an independent review finds no P0-P2 release
  safety regression.

Implementation task:
[release-preview-version-log-008](../plan/tasks/release-preview-version-log-008.md).

## Resolution

- Exported the existing shared `releaseVersionCode()` helper and imported it into the publisher.
- Added a fake-client regression that executes the valid-existing-remote branch and asserts its
  exact object key and version log without network or release side effects.
- Preserved the completed `0.0.80 / 260901100018` bump during implementation and every
  release-order rejection rule.
- The focused release suite passed 29/29 and [review 1](../plan/reviews/release-preview-version-log-008-1.md)
  found no P0-P2 issue.
- A subsequent operator retry of the one-step alias advanced the worktree to
  `0.0.81 / 260901100557` and crossed the repaired existing-remote branch into the Preview build.
  That later process ended without producing a `0.0.81` installer; its terminal error is separate
  from this resolved undefined-helper failure.
