# Review: release-notarization-retry-004

Target: `7d0405c7ee235f1df86097e3671e7620ff19522a`

## Findings

No unresolved P1, P2, or P3 findings.

The first source review found that generic `HTTPClientError`, `SotoS3`, and `NSURLError` names made
the retry classifier broader than the network-only contract; the fresh application ZIP omitted
`--sequesterRsrc`; and parser/classifier regression checks lacked positive and negative fixtures.
A second source review also identified version-prefix ambiguity when selecting a DMG. All findings
were corrected before the final review.

One reviewer initially reported that the positive `--s3-acceleration` and `--progress` switches were
invalid. Local Xcode 26.4 `notarytool submit --help` and `notarytool wait --help` explicitly list both
positive/negative switch pairs and show both defaults as enabled. That finding was therefore
dismissed without submitting an artifact.

## Verification

- `electron-builder.tmp.yml` disables built-in application notarization and registers the named
  `afterSign` hook; generated `electron-builder.yml` is untouched.
- Signing completes before the custom application notarization hook, and ZIP/DMG artifact creation
  begins only after the hook resolves.
- Application submission always uses a unique fresh ZIP with `--sequesterRsrc` and cleans it in a
  `finally` path.
- Submit and wait are separate operations. Wait retries reuse the parsed submission ID, and only
  concrete connection, timeout, HTTP 429, or HTTP 5xx transport fixtures are retryable.
- Authentication, HTTP 4xx, certificate, preflight, malformed-package, `Invalid`, and `Rejected`
  outcomes do not enter upload retry.
- Tool output is streamed with timestamps while Apple ID, app-specific password, and team ID values
  are redacted.
- Accepted application and DMG targets are stapled and validated explicitly; no directory scan can
  staple an unrelated artifact.
- Publication awaits DMG notarization and uses a version-boundary match that rejects stale prefix
  collisions before requiring exactly one DMG.
- `notarize:file` forwards one exact application or DMG path through the guarded CLI without
  executing the CLI when the module is imported.
- Electron remains `40.10.6`, `better-sqlite3-multiple-ciphers` remains `12.11.1`, and
  `fast_publish:mac_arm` retains pull → frozen install → patch → build → publish ordering.
- Per owner request, review was source-only. No test, build, signing, notarization, upload,
  publication, or fast-publish command was run.

## Conclusion

pass
