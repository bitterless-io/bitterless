# Development package metadata blocks Stable publication

Status: implemented; owner release verification pending

## Observed behavior

Stable publication passes the SQLite migration audit and remote version-order check, then rejects
the local artifacts with:

```text
Stale dist release metadata: expected channel prod, received dev. Rebuild before publishing.
```

Development release and Stable currently share the same generated `dist/` root. A later
`build_dev:*` therefore replaces Stable's `dist/version_info.json` and packaged output with Dev
identity. The Stable publisher correctly fails closed, but an unrelated Development package should
never be able to poison the Stable artifact lane.

## Required behavior

- Stable owns `dist/`.
- Development release owns `dist/dev/`.
- Preview owns `dist/preview/`.
- Builder output, local version metadata, package audit, artifact discovery, publication staging,
  and identity verification must all use the selected channel's exact directory.
- Keep the current channel/identity check. Never relabel a Dev artifact as Stable or bypass stale
  artifact validation.
- Existing generated artifacts are not migrated or rewritten; the next channel-specific build
  populates its isolated lane.
- User-facing Stable `publish:*` aliases are one-step source publication commands: they must select
  the production profile and build before reading local artifacts. The lower-level `publish.js`
  command retains explicit artifact-only operation when `--build` is omitted.

## Acceptance

- A pure Node `before.js` fixture proves `release_dev` writes Builder output and
  `version_info.json` below `dist/dev/` with `channel: dev`.
- Release helper tests prove the three exact channel directories are distinct.
- Package-script tests prove every Stable `publish:*` alias passes `--build`, while fast publish
  reuses that single build path instead of building twice.
- Preview and Stable output contracts remain unchanged.
- No build, signing, notarization, upload, CDN refresh, Electron, or E2E runs during verification.

Implementation task:
[release-dev-dist-isolation-105](../plan/tasks/release-dev-dist-isolation-105.md).

## Delivery

- Development package generation and publication now use `dist/dev/`; Stable and Preview retain
  `dist/` and `dist/preview/`.
- Channel identity validation derives the expected Builder output from the same three-way mapping.
- Stable `publish:mac_arm`, `publish:mac_intel`, and `publish:win` now rebuild the selected prod
  artifact before upload. Fast macOS ARM publish delegates to that same one-build path.
- Runtime-profile and release-hook suites passed 41/41; both modified scripts passed syntax checks
  and `git diff --check` passed. No release side effect ran.
