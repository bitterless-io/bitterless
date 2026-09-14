# Zellij external tool distribution

Status: implemented; real packaging and runtime testing pending. Owner decision: 2026-09-10, initialize Zellij
through the existing `yarn tools:init` command in Bitterless and Cowork.

## Contract

- Pin Zellij `0.45.1` in `package.json` as `zellij_version` and in the external-tools
  inventory. Use the official `zellij-org/zellij` release assets for macOS ARM64,
  macOS Intel, and Windows x64. The Windows store remains named `win`; its package
  target is `win64`.
- Verify both the compressed archive SHA-256 and extracted binary SHA-256 before
  installation. Archives contain `zellij` at the root on macOS and `zellij.exe`
  at the root on Windows.
- Include Zellij in each platform's exact payload manifest, cache validation,
  offline stage/verify commands, platform audit, and macOS signing list. The
  existing initialization/atomic replacement process owns installation.
- `yarn tools:init` validates/prepares all three platform stores, then prepares and verifies
  the current host's `build/maestro-tools` directory. It is sufficient preparation for both
  development and the supported packaging targets.
- Default initialization checks before downloading: complete valid stores remain untouched;
  partial/invalid stores reuse pinned, verified payloads and download only missing/invalid
  binary archives or AnyDoc package/native units. Invalid/missing generated
  `external-tools.manifest.json` alone is repaired locally. Explicit `--force` remains an
  intentional full refresh.
- Valid staged tools remain untouched. Missing, invalid, obsolete or wrong-platform managed
  staging is replaced from a validated cache with rollback on failure. DEBUG dev/build/start
  preparation ensures the host stage offline; packaging retains its target-specific offline
  stage/verify. These preparation paths never install/rebuild Node dependencies or select a
  system Zellij installation.
- `external_tools` remains an ignored local cache. Packaged binaries remain in
  `Resources/maestro-tools`, outside `app.asar`. No system installation or new
  package dependency is introduced.
- Distribution does not register an agent tool, start a server, create a terminal
  window, authenticate a session, or change the default-off Terminal preference.
  Explicit runtime initialization is provided by the [Zellij miniapp](zellij-miniapp.md).

## Sources

- [Zellij 0.45.1 release](https://github.com/zellij-org/zellij/releases/tag/v0.45.1)
- Archive hashes match each asset's digest in the
  [official GitHub release metadata](https://api.github.com/repos/zellij-org/zellij/releases/tags/v0.45.1).
- Extracted binary hashes match the accompanying official `.sha256sum` files.
  All three artifacts and checksums were verified on 2026-09-10; pinned values
  are recorded in `scripts/maestro/externalTools.cjs`.

## Verification

2026-09-12 initialization/readiness follow-up:
[task 174](../plan/tasks/external-tools-init-dev-ready-174.md) adds incremental payload reuse,
host preparation at init, and offline DEBUG preparation. Actual repeated initialization attempted
zero downloads, preserved 37 cache files and then all 11 valid staged files, repaired the obsolete
stage, and passed host/native/build checks. The task records test counts and remaining validation
limits.

Verified on 2026-09-10:

- `yarn test:maestro-external-tools`: 11/11 passed, including Zellij release pins,
  missing/tampered payload rejection, all three platform stage/verify paths, and
  opposite-platform filename cleanup.
- `yarn test:desktop-package-audit`: 34/35 passed. Zellij missing/wrong-architecture
  rejection passed for all three targets. The existing synthetic `afterPack` test
  still fails because its context lacks `packager.appInfo`, as already recorded in
  [the platform-audit issue](../issues/tools-init-entry-and-unaudited-packaged-tool-platform.md).
- Extracted all three cached official Zellij archives and rechecked compressed and
  extracted SHA-256 values. Reused existing verified tool payloads through the
  initializer's test seam, then installed each new manifest/cache through its
  regular validation and atomic replacement. No download was required.
- `yarn tools:init` subsequently verified all three real caches without downloads.
  All three real payloads passed isolated offline stage/verify; the repository's
  development staging directory was restored to `mac_arm`, and
  `yarn tools:verify mac_arm` passed.
- The package auditor identified the actual Zellij binaries as Mach-O ARM64,
  Mach-O x64, and PE32+ x64. The host binary returned `zellij 0.45.1` for `--version`.
- `node --check scripts/maestro/externalTools.cjs` and `git diff --check` passed.

No Electron app, Zellij server, signed package, or E2E run was started. Windows
web-server behavior and real package signing remain later platform tests.
