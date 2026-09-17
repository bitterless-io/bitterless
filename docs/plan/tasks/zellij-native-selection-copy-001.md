---
id: zellij-native-selection-copy-001
scope: main/zellij/clipboard
status: done
depends-on: []
verify: code-passed; owner-packaged-copy-pending
---

## Objective

Make plain macOS Cmd+C copy ordinary Zellij native selections as well as browser selections.

## Context

[Confirmed defect and repair contract](../../issues/zellij-terminal-cmd-copy-paste.md).

## Path

Native protocol projection/types, web bridge, runtime/surface integration, key bridge, and focused
`tests/zellij/` regression tests. Preserve unrelated edits and prior login/theme changes.

## Verification

Reproduce empty xterm selection during real native drag. Verify exact-client fresh native Copy
response, Unicode, no selection, fragmented traffic, isolation, cancellation and lifecycle;
preserve existing browser copy/paste behavior. Focused tests, scoped TypeScript/lint,
independent review, then the Zellij suite. No Electron E2E or actual clipboard mutation.

## Results — 2026-09-17

- Focused copy/key/Unix bridge regression tests: 28/28 passed.
- Full Bitterless Zellij suite: 211/211 passed; no skipped tests.
- Scoped strict TypeScript, ESLint and diff checks passed.
- Actual isolated Zellij 0.45.1 web client: six acceptance groups passed with browser clipboard
  permission denied and Main clipboard replaced by a memory sink. Native Chinese/emoji/multiline
  drag, immediate and repeated copying, empty-selection preservation, browser selection and
  same-target re-registration were verified without an Electron launch or OS clipboard writes.
- [Independent review](../reviews/zellij-native-selection-copy-001-1.md): PASS. Same-target
  registration now preserves the attached client; UTF-8 copying preserves a leading U+FEFF.
- Owner-authorized `yarn publish_preview:mac_arm` succeeded with exit code 0. Published Preview
  macOS arm64 **0.0.122 / 260917010242**, with application and DMG signing, notarization and
  stapling validated. Package audit passed; the built `app.asar` contains the native-copy service,
  fallback, marker/barriers and BOM-preserving decoder.
- OSS upload and CDN refresh completed. Public version/update manifests match the release;
  installer size **208127451 bytes** and manifest SHA-512 match the local signed DMG. The public
  installer HEAD size matches; the full remote binary was not downloaded again.
- [Preview installer](https://assets.terncloud.com/bitterless/distro/preview/mac_arm/Bitterless-Preview-0.0.122.dmg).
  Installed package copy acceptance remains pending; command discovery was already
  owner-confirmed after rebuilding the old session. No Electron E2E or packaged app launch.
