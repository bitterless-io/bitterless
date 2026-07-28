# macOS notarization upload times out through S3 acceleration

Status: implemented; owner verification pending

## Report

The signed `0.0.37` macOS ARM application passed package audit and application notarization, but two
consecutive DMG notarization submissions aborted during Apple's multipart upload with
`HTTPClientError.deadlineExceeded`. Later application notarization attempts failed at the same
transport boundary, including one upload with no completed parts and another after two completed
parts. None of these failures reached an accepted/rejected notarization result.

## Findings

`notarytool submit` enables S3 Transfer Acceleration by default. The current Shanghai development
network through the owner's stable Japan VPN can reach Apple's notary service, as proven by an
accepted application notarization, but both application ZIP and DMG multipart uploads can still
exceed the individual HTTP request deadline. Disabling S3 acceleration was tested as a workaround,
but the direct regional S3 path failed sooner with zero completed parts. The workaround is therefore
a regression in this environment, not a confirmed resolution.

The failing output contains `abortedUpload`, `SotoS3`, and
`HTTPClientError.deadlineExceeded`, so the root cause is the upload transport rather than signing,
architecture, credentials, or an Apple validation rejection. Electron Builder's built-in
application notarization also makes this boundary opaque: it waits inside the build, does not expose
a reusable application-only retry command, and reports little progress before the upload aborts.

## Resolution contract

- Keep the default accelerated upload route explicitly; do not restore
  `--no-s3-acceleration`.
- Replace Electron Builder's built-in application notarization with an `afterSign` hook. Signing
  remains owned by Electron Builder, then the hook submits and staples the signed `.app` before ZIP
  or DMG artifact creation begins.
- Separate `notarytool submit` from `notarytool wait`. A successful submission ID is retained so a
  transient wait failure resumes the same Apple request instead of uploading the artifact again.
- Stream timestamped submit, wait, retry-delay, result, staple, and validation progress to the
  terminal. Credentials must never appear in logs.
- Retry only recognized network transport failures with bounded backoff. Authentication,
  preflight, malformed-package, `Invalid`, and `Rejected` results fail immediately.
- Recreate the temporary application ZIP for every application submission attempt so an old ZIP
  cannot be notarized after a new signed application is produced.
- Use the same helper for DMG publication. Application and DMG notarization remain independently
  rerunnable, but neither accepted-status nor staple validation may be bypassed.
- `yarn fast_publish:mac_arm` enables the `electron-osx-sign` debug namespace for its macOS build
  stage by default so the terminal shows the file currently being signed. The debug environment is
  scoped to `yarn build:mac_arm`; it does not need to wrap source synchronization or artifact upload.

## Verification

- Source contracts must cover the custom `afterSign` hook, default acceleration, bounded
  network-only retries, live progress, accepted-status gate, and application/DMG staple validation.
- The release-hook contract must preserve the default per-file signing progress on
  `fast_publish:mac_arm`.
- Per owner request, this change is reviewed without running tests, signing, notarization,
  packaging, upload, or publication. The owner will exercise the complete path with
  `yarn fast_publish:mac_arm`.
- A successful DMG notarization, staple validation, production upload, and public manifest check
  are still required to close the issue.
