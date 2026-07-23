# macOS DMG notarization upload times out through S3 acceleration

Status: fixed

## Report

The signed `0.0.37` macOS ARM application passed package audit and application notarization, but two
consecutive DMG notarization submissions aborted during Apple's multipart upload with
`HTTPClientError.deadlineExceeded`. The first reached 37 parts and the retry stopped after 4 parts;
neither submission reached an accepted/rejected notarization result.

## Confirmed cause

`notarytool submit` enables S3 Transfer Acceleration by default. The current Shanghai development
network can reach Apple's notary service, as proven by the accepted application notarization, but
the accelerated multipart path is unstable for the 207 MiB DMG. This is an upload transport
failure, not a code-signing, package, architecture, or notarization-validation rejection.

## Resolution

- Submit the DMG with Apple's supported `--no-s3-acceleration` option so the upload uses the direct
  S3 path.
- Keep `--wait`, accepted-status validation, staple, and staple validation unchanged; do not bypass
  notarization.
- Retain a release-hook source test so future publisher changes cannot silently restore the failing
  accelerated path.

## Verification

- `xcrun notarytool submit --help` confirms `--no-s3-acceleration` is supported and disables the
  default accelerated upload.
- `yarn test:sqlite-migrations` covers the publisher flag and existing signing/notarization gates.
- A successful DMG notarization, staple validation, production upload, and public manifest check
  close the operational acceptance.
