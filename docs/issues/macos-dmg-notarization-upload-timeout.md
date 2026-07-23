# macOS DMG notarization upload times out through S3 acceleration

Status: active

## Report

The signed `0.0.37` macOS ARM application passed package audit and application notarization, but two
consecutive DMG notarization submissions aborted during Apple's multipart upload with
`HTTPClientError.deadlineExceeded`. The first reached 37 parts and the retry stopped after 4 parts;
neither submission reached an accepted/rejected notarization result.

## Findings

`notarytool submit` enables S3 Transfer Acceleration by default. The current Shanghai development
network can reach Apple's notary service, as proven by the accepted application notarization, but
the 207 MiB DMG upload timed out on the accelerated path. Disabling S3 acceleration was then tested
as a workaround, but the direct regional S3 path failed sooner with zero completed parts. The
workaround is therefore a regression in this environment, not a confirmed resolution. The failure
remains an upload transport problem rather than a code-signing, architecture, or Apple validation
rejection.

## Current decision

- Restore `notarytool`'s default accelerated upload behavior by removing
  `--no-s3-acceleration`.
- Keep `--wait`, accepted-status validation, staple, and staple validation unchanged; do not bypass
  notarization.

## Verification

- `yarn test:sqlite-migrations` must continue covering the accepted-status and stapling gates without
  requiring a specific S3 transport flag.
- A successful DMG notarization, staple validation, production upload, and public manifest check
  are still required to close the issue.
