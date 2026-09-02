# release-preview-version-log-008 — Review 1

- Date: 2026-09-01
- Scope: independent release-safety review of the existing-remote Preview preflight repair against
  `docs/plan/tasks/release-preview-version-log-008.md`.
- Method: task, issue, task-scoped diff, helper export/import, release-order guard, preflight/build/
  upload ordering, and focused fake-client regression inspection. No real publishing operation or
  network request was used.

## Findings

No unresolved P0-P2 findings.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| One version-code normalizer | `releaseChannel.cjs` retains the sole `releaseVersionCode()` implementation and now exports it; `publish.js` imports it instead of keeping an inline copy. | pass |
| Release-order policy is unchanged | Remote validation, `compareVersions`, semantic downgrade, semantic reuse, version-code downgrade, and version-code reuse rejection branches are unchanged. The local extraction is equivalent to the previous inline expression. | pass |
| Exact failing branch is covered | The fake client returns an existing valid Preview manifest. The test asserts the exact `bitterless/distro/preview/mac_arm/version_info.json` key and the success log containing both version codes, which executes the former `ReferenceError` line. | pass |
| No release side effects | The regression creates no OSS client, reads no credentials, makes no network request, and performs no build, signing, notarization, upload, or CDN refresh. Production orchestration order has no task diff. | pass |
| Existing bump is retained by the repair | During task implementation and review, `package.json` remained at the first user command's `0.0.80 / 260901100018`; task 008 did not edit it or run `patch.js`. A later operator retry advanced it after this review. | pass |

## Verification

- Independent source/diff review: approved, no P0-P2 findings.
- `node --test scripts/sqlite-migrations/release-hook.test.mjs`: passed, 29/29.
- `node --check scripts/publish.js`: passed.
- `node --check scripts/release/releaseChannel.cjs`: passed.
- `git diff --check`: passed.
- Preview publish/build, signing, notarization, upload, CDN refresh, network, Electron, and E2E:
  not run.

## Conclusion

**Approved — no P0-P2 findings.**

The existing-remote Preview preflight now reaches its success log through the shared version-code
normalizer, while all release ordering and mutation boundaries remain unchanged.

After this review, an operator reran the one-step alias. The worktree advanced to
`0.0.81 / 260901100557` and entered the Preview build, confirming that the original preflight crash
was cleared; that later command was not part of the review verification.
