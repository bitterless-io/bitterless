---
id: maestro-external-tools-094
scope: initialize and package Maestro's platform external tools outside app.asar
status: done
depends-on: [maestro-cowork-chat-files-090]
verify: focused pure Node packaging tests, syntax checks, diff check, independent source review
---

# Package Maestro external tools from an offline platform store

## Objective

Move AnyDoc and Ouch build inputs out of the ASAR-selected tree, add pinned Bun/ripgrep/fd inputs,
and make supported desktop packaging consume one already-initialized platform directory without
network access.

## Context

- `docs/issues/maestro-tools-packaged-inside-asar.md`
- `docs/features/desktop-release-channels.md`
- `scripts/prepare-maestro-anydoc.cjs`
- `scripts/prepare-maestro-archive.cjs`
- Micromeet Cowork's bundled-runtime preparation is a behavior reference, not a file-copy contract.

## Path

- `external_tools/.gitignore`
- `external_tools/{mac_arm,mac_intel,win}/.gitkeep`
- `package.json`
- new external-tool initialization/staging scripts and their focused tests
- `electron-builder.tmp.yml`
- relevant package-audit/source guards
- this task, its issue, indexes, and review artifact

## Contract

- Pin Bun, ripgrep, fd, Ouch, and AnyDoc versions in `package.json`; never resolve `latest`.
- `yarn external-tools:init` initializes all three requested targets. It may download and extract,
  verifies the established AnyDoc release hashes, records every staged file's SHA-256 and size in a
  per-platform manifest, writes via temporary directories, and replaces a platform only after its
  complete inventory validates.
- The platform directory names are exactly `mac_arm`, `mac_intel`, and `win`; package target
  `win64` maps to local directory `win`.
- Package staging performs no network call. It validates version pins, the exact allowlisted file
  tree, manifest hashes/sizes, AnyDoc package metadata, and target filenames before copying.
- Stage into the existing `build/maestro-tools` resource root without removing the Micromeet CLI
  staged immediately before it. Remove stale external-tool artifacts from another target.
- Do not commit initialized binaries or manifests. Preserve each tracked `.gitkeep` during
  initialization and ignore every other descendant.
- Exclude `external_tools/**` and legacy `prebuilt/**` from Electron Builder's ASAR files. Add Bun,
  ripgrep, fd, and existing native/executable tools to the macOS signing inventory.
- Keep Linux package scripts on their existing path; do not invent unsupported Linux tool assets.
- Preserve unrelated current-worktree and release-version changes. Do not initialize/download,
  package, launch Electron, sign, notarize, publish, or run E2E in this task.

## Verification

- focused Node tests covering initialization metadata helpers and a fixture-only offline stage;
- `node --check` for every changed CommonJS script;
- source assertions for package aliases, ASAR exclusions, `extraResources`, package ordering, and
  macOS `binaries`;
- `git diff --check`;
- independent source review for P0-P2 packaging, integrity, and cross-platform defects.

## Delivery

- Added the exact three requested platform directories and an ignore contract that tracks only the
  repository scaffolding, never initialized artifacts.
- Added one pinned, checksum-verified initializer plus strict manifest/tree/hash validation and an
  offline platform stage that preserves the already-staged Micromeet CLI.
- Routed macOS/Windows package and unpack flows through the offline stage. A host dispatcher keeps
  Linux unpack on its pre-existing AnyDoc/Ouch flow; dedicated Linux package commands are unchanged.
- Excluded `external_tools/**` and `prebuilt/**` from `app.asar`, kept the existing external-resource
  destination, and added Bun/ripgrep/fd to the macOS signing inventory beside Micromeet, Ouch, and
  AnyDoc.
- `yarn test:maestro-external-tools` passed 10/10; `yarn test:desktop-package-audit` passed 25/25;
  `check-file-reading`, both CommonJS syntax checks, and `git diff --check` passed.
- [Independent review 1](../reviews/maestro-external-tools-094-1.md) initially found two P2 gaps
  (Linux generic-unpack dispatch and insufficient cross-platform fixture coverage). Both were fixed,
  reverified, and approved with no remaining P0-P2 issue.
- No initializer/download, build/package, Electron/E2E, signing, notarization, publication, or
  network operation ran. Owner initialization and real-package verification remain pending.
