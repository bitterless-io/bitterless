# Zellij in DEBUG cannot find tools already initialized in the local cache

Status: fixed and tooling-verified 2026-09-12

## Report

Ral runs `yarn dev:prod`, opens Zellij, and receives:

> The bundled Zellij binary is missing. Run yarn tools:init and stage the tools, or reinstall the application.

Ral already ran `yarn tools:init`.

## Root cause

Initialization and runtime preparation use different directories, and the DEBUG entry does not
connect them. This is a missing development-startup integration, not a failed Zellij download.

1. `package.json:106` invokes `scripts/maestro/externalTools.cjs init`.
   `initializeAll()` at script line 653 validates/initializes the three platform stores under
   `external_tools/{mac_arm,mac_intel,win}`. It does not call `stageExternalTools()`.
2. `stageExternalTools()` at script line 703 separately validates the chosen platform cache,
   copies it to `build/maestro-tools`, and verifies that directory.
3. `package.json:97-100`: `dev:prod` selects `debug_prod` and runs `_dev:debug`, which only checks
   the runtime profile, runs `before.js`, and launches Electron Vite. Neither this entry nor
   DEBUG build preparation stages external tools. Supported packaging entries explicitly stage
   them later; an ordinary development build never reaches those packaging steps.
4. `src/main/zellij/zellijRuntime.service.ts:46-54` resolves an unpackaged app's executable only
   from `<app.getAppPath()>/build/maestro-tools/zellij` on macOS. It does not consult
   `external_tools/mac_arm/zellij` or a system installation. Packaged apps use
   `<process.resourcesPath>/maestro-tools/zellij`. This branch depends on `app.isPackaged`, not
   the production backend selected by `dev:prod`.

The existing compiled `out/main/app.main.js:6428-6436` has the same resolver. The selected build
marker is `debug_prod`; a stale compiled path does not explain this report.

## Local evidence

Investigated on macOS ARM64 in `<project-root>`:

- All three platform caches contain Zellij `0.45.1` and matching manifests. Extracted binary
  SHA-256 values match the repository's pinned inventory.
- `external_tools/mac_arm/zellij` exists, has executable mode `755`, and is 41,421,856 bytes.
  Its SHA-256 is `ca5f9333735bdbc59a621f1d8ed8e24798845302a28ff175d253d4793d5a4a2c`.
- The real read-only `validateExternalStore(projectRoot, 'mac_arm')` passes.
- `build/maestro-tools` contains only `manifest.json` and `micromeet`; it has neither `zellij`
  nor `external-tools.manifest.json`.
- The real read-only `verifyStagedExternalTools(projectRoot, 'mac_arm')` fails: expected the
  AnyDoc payload, `bun`, `external-tools.manifest.json`, `fd`, `ouch`, `rg`, and `zellij`, but
  found only `manifest.json` and `micromeet`.

The distribution document records a successful manual stage on 2026-09-10. That historical
verification does not establish that the ignored staging directory remains populated today.
This investigation does not establish when or by which process the previous payload disappeared.

## Why tests did not catch it

- `tests/zellij/zellijRuntime.test.mjs:21-23` bundles the process/config/token services, not the
  production runtime resolver. Its `checkBinary` fixture at line 62 is a no-op.
- `tests/zellij/zellijDefaultConfig.test.mjs:38-39` skips when the staged binary is missing. Its
  skip hint says to run `tools:init`, which likewise does not populate the directory it checks.
- Missing staging therefore permits ordinary unit checks and the application compilation to pass.
  A future regression test needs to cover the real dev-preparation-to-runtime-path connection.

The runtime error is emitted by `checkBinary()` before configuration initialization, port probing,
or process startup (`src/main/zellij/zellijProcess.service.ts:131`). It propagates through the
Zellij snapshot to the `binary-missing` i18n text (`src/renderer/common/i18n/en.ts:995`).

## Required repair (owner request 2026-09-12)

Ral requires `tools:init` to make packaging and development ready, checking existing dependencies
before downloading instead of needlessly initializing them again.

- Preserve initialization of all three platform stores for packaging, then stage and verify the
  current host's tools for development in the same successful `tools:init` command.
- A valid cache is reused unchanged with zero downloads. If a store is incomplete or invalid,
  reuse each payload whose bytes match the current pinned inventory; download only the affected
  tool/archive. Rebuild metadata locally when the payload itself is already valid.
- Treat AnyDoc's JavaScript package archive and platform-native binary as separate download
  units: one missing unit must not force another valid unit to download again.
- Reuse a correct staged directory unchanged. Repair a missing, corrupt or wrong-platform staged
  directory from the validated cache, removing obsolete generated contents through replacement
  of this managed output only. Keep failed replacements rollback-safe.
- Development preparation restores the current host stage offline, including after a different
  platform was packaged. An already verified host stage is sufficient; when stage repair is
  needed, missing/invalid caches fail early with the `tools:init` instruction. Development and
  packaging themselves do not download tools.
- Keep package-target staging/verification and runtime's bundled-only resolution. Do not rebuild
  `node_modules`, change tool pins, or launch the application while preparing tools.

Task: [external-tools-init-dev-ready-174](../plan/tasks/external-tools-init-dev-ready-174.md).

## Implementation result

- `tools:init` now prepares all three caches and verifies/stages the current host before success.
- Cache repair checks each tool against current pinned hashes and reuses valid bytes; AnyDoc
  package/native repair is independent. A valid cache/stage is left untouched.
- DEBUG dev/build/start calls the existing offline stage command. Needed stage repair is built
  and validated in a temporary directory before replacing the managed output, including retired
  `manifest.json`/`micromeet` residue.
- On the real mac_arm host, two `tools:init` executions attempted zero downloads and preserved
  all 37 cache files. The first fixed the previously incomplete stage; the second preserved all
  11 stage files' mtimes/inodes. `tools:verify` and staged Zellij `--version` passed.
- 31 external-tools tests, 22 runtime/preparation tests, 3 native configuration checks and the
  original DEBUG_PROD build passed. See task 174 for the incomplete default-lint and package-audit
  checks; no full signed package or Electron/E2E was exercised.
- [Independent review](../plan/reviews/external-tools-init-dev-ready-174-1.md) passed with no
  P1/P2 blocking findings and independently revalidated all three real caches plus the host stage.

## Original diagnosis and proposed remedy

The existing missing operation is `yarn tools:stage mac_arm`, followed by `yarn tools:verify mac_arm`.
It copies and verifies the already-initialized cache; another download is unnecessary.

Recommended code repair: have shared DEBUG preparation stage and verify the current host platform
before dev/build starts, using the existing external-tools implementation and keeping packaged
resolution unchanged. This makes `tools:init` followed by `dev:prod` a complete development flow
and fails early if the cache is missing or invalid.

No source fix, cache/staging mutation, Electron launch, Zellij server, or E2E was performed during
the initial root-cause request. The follow-up above now authorizes preparation and code repair;
existing SQLite repair changes in the worktree remain protected.

## Related contracts

- [External tool distribution](../features/terminal-zellij-distribution.md)
- [Zellij miniapp](../features/zellij-miniapp.md)
- [Initialization entry and packaged-platform audit](tools-init-entry-and-unaudited-packaged-tool-platform.md)
