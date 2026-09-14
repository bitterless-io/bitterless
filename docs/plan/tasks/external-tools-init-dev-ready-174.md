---
id: external-tools-init-dev-ready-174
scope: make tools:init prepare package caches and host development tools with verified incremental reuse
status: done
depends-on: []
verify: external-tools behavioral tests, runtime-profile integration, package audit, actual offline init/stage reuse; no Electron/E2E
---

# Make external tool initialization sufficient for development and packaging

## Objective

After `yarn tools:init`, the host development Zellij binary exists at the real runtime path and
all supported package targets retain validated caches. Repeat initialization and build preparation
must reuse valid dependencies instead of downloading or recreating them unnecessarily.

## Context

- `docs/issues/zellij-debug-runtime-misses-initialized-tools.md`
- `docs/features/terminal-zellij-distribution.md`
- `docs/issues/tools-init-entry-and-unaudited-packaged-tool-platform.md`
- `scripts/maestro/externalTools.cjs`, `scripts/before.js`, `package.json`
- `src/main/zellij/zellijRuntime.service.ts`

## Path

- `scripts/maestro/externalTools.cjs` and `externalTools.test.mjs`
- DEBUG preparation entries/helper and narrowly affected fixture tests under `scripts/environment/`
- `package.json`, only if command wiring is needed; preserve all SQLite-task/pre-existing edits
- `tests/zellij/zellijDefaultConfig.test.mjs` only if its preparation diagnostic needs alignment
- affected packaging tests only where contract changes require them
- task, issue, feature contracts, indexes, historical task-094 supersession note and independent
  review (owned by root)

## Contract

- `tools:init` still initializes mac_arm/mac_intel/win stores on every supported host. It also
  stages/verifies the detected host at the exact unpackaged runtime location before success.
- A valid platform store is a no-op: zero downloads and no dependency rewrites. For an invalid
  store, reuse regular non-symlink payloads only after validating against current pinned SHA-256,
  with executable permissions repaired locally if needed. Do not trust old manifest values as
  the authority for reuse. Preserve the existing archive checksum and exact-tree gates.
- Download granularity: each binary tool archive, the AnyDoc JS package archive, and the AnyDoc
  platform native binary. Missing/corrupt manifest or unrelated extra files do not force valid
  payload downloads. Explicit `--force` retains its intentional full-refresh behavior.
- Preserve rollback-safe store replacement and add equivalent managed-stage replacement. An
  already valid stage is a no-op. Repair legacy `manifest.json`/`micromeet` residue only inside
  managed `build/maestro-tools`; no source deletion or arbitrary directory cleanup.
- DEBUG dev/build/start ensures host staging offline, before Electron begins. A valid host stage
  is sufficient; when repair is needed, missing/invalid cache fails clearly with `tools:init`.
  It never silently downloads. Packaging stages its
  specified target offline, even after host init or another target build.
- Preserve tool pins, runtime bundled-only path, package identity, selected debug_prod profile,
  `node_modules`, previous SQLite work, current branch and independent-project boundaries.
- Do not launch Electron, Zellij web, or E2E; do not publish/sign packages or run Git sync.

## Verification

- Behavioral fixtures: first init creates ready host stage; repeat init has zero download calls
  and unchanged dependency mtimes; one missing/corrupt payload downloads only its unit; metadata-
  only repair has zero downloads; AnyDoc JS/native reuse is independent; forced refresh remains
  explicit; failed preparation preserves existing caches/stage; opposite-platform stage repairs
  offline and stale generated residue is removed from the managed output.
- Exercise real DEBUG command wiring with fixtures/stubbed Electron launcher so no GUI starts;
  show a successful init leaves the exact runtime binary path available.
- `yarn test:maestro-external-tools`, relevant runtime-profile/build-preparation tests, package
  audit tests, appropriate lint/syntax checks and independent review.
- Actually run `yarn tools:init` using the existing valid local caches; confirm no downloads,
  host stage verification, and a second run preserves binary mtimes. Capture bounded results.
- Build verification must use the original selected debug_prod profile and preserve previous
  task changes. Do not invoke a typecheck script that internally runs `npx`.

## Implementation and initial verification

- `tools:init` prepares every platform cache and then the host stage. The existing `stage` command
  now verifies first and returns without writes for valid output; repair uses a validated temporary
  directory and rollback-safe replacement.
- `_dev:debug`, `_build:debug` and `_start:debug` invoke offline host staging before Electron Vite.
  `before.js` and release preparation remain unchanged by this task.
- Invalid cache repair reuses current-inventory SHA-256 matches. AnyDoc bundle/native downloads
  are independent; generated manifest repair and executable-mode repair require no download.
- Focused suites pass: 31 external-tools cases and 22 runtime/build-preparation cases. Four new
  public-alias fixture tests use the real package scripts/profile wrapper/before script with a
  fixture Rig adapter, fixture-inventory CLI adapters calling the production preparation exports,
  and a stub Electron Vite launcher. Real cache/stage runs and the real build below are separate
  evidence; fixture passes are not presented as full application startup.
- Actual `yarn tools:init` was run twice with download invocation blocked and counted. Both runs
  attempted zero downloads and preserved all 37 external-tools cache files. The first repaired
  the obsolete `manifest.json`/`micromeet` stage into valid mac_arm output. The second preserved
  all 11 staged files' mtimes and inodes.
- Package audit reports 34/35: the previously recorded synthetic `afterPack` fixture still lacks
  `packager.appInfo`. This task does not claim that unrelated suite is entirely passing.

- Staged `zellij --version` returns `zellij 0.45.1`; three real default-config checks pass without
  a web server, token creation or Electron launch.
- Original-profile build passes using
  `node scripts/environment/runWithRuntimeProfile.cjs debug_prod -- yarn _build:debug`.
  Final metadata is `Bitterless_DEBUG_PROD`, version code `260912205944`; original `.env.rig` is
  restored byte-for-byte and the output marker agrees on the DEBUG_PROD runtime.
- Default ESLint is not clean: the CJS file has the same 40 errors as HEAD (5 CommonJS-import
  and 35 explicit-return-type reports); the existing test file rises from 10 to 14 return-type
  reports because four added plain-JS helpers follow its existing style. Semicolon warnings
  reflect that legacy style too. Targeted lint disabling those convention rules passes; the new
  integration test passes default lint. No claim is made that all reports are pre-existing or
  that default lint passes. Syntax and diff checks pass.

[Independent review 1](../reviews/external-tools-init-dev-ready-174-1.md): pass, no P1/P2 blocking
findings. It independently validated all three real caches, the mac_arm stage, compiled runtime
path, package wiring and original-profile build identity.

No signed packaging, Electron/E2E, Zellij server or user database operation was performed.

OnlyPreview handoff was attempted for this task document, but the configured Production MCP
bridge socket remains unavailable. No DEV/DEBUG bridge or alternate editor was substituted.
