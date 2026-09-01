---
id: release-dev-dist-isolation-105
scope: isolate Development release artifacts and make Stable publish aliases build prod first
status: implemented; owner release verification pending
depends-on: [release-preview-channel-007, release-local-fast-publish-005]
verify: node --test scripts/environment/runtimeProfile.test.mjs scripts/sqlite-migrations/release-hook.test.mjs && node --check scripts/before.js && node --check scripts/release/releaseChannel.cjs && git diff --check
---

# Isolate Development release output under dist/dev

## Objective

Prevent a Development package from replacing Stable's generated metadata or artifacts while
retaining fail-closed Stable publication identity checks.

## Context

- `docs/features/desktop-release-channels.md`
- `docs/issues/stable-publish-dev-dist-contamination.md`
- `docs/features/sqlite-migration-release-gate.md`

## Path

- `scripts/before.js`
- `scripts/release/releaseChannel.cjs`
- `scripts/environment/runtimeProfile.test.mjs`
- `scripts/sqlite-migrations/release-hook.test.mjs`
- feature, issue, plan, and index documents

## Contract

- Map release channels exactly: `prod -> dist`, `dev -> dist/dev`, `preview -> dist/preview`.
- Use the same mapping for generated Electron Builder output, `version_info.json`, package audit,
  artifact lookup, publication staging, and Builder identity validation.
- Make every Stable `publish:*` package alias pass `--build` so it cannot reuse stale Dev metadata.
  Keep raw `publish.js` artifact-only behavior available when an operator intentionally omits that
  flag.
- Make `fast_publish:mac_arm` retain install and patch ordering, then delegate to the one-step Stable
  alias so it performs exactly one production build.
- Preserve Dev product/bundle identity, production API separation, artifact naming, OSS paths, and
  updater paths.
- Preserve Stable's `expected channel prod` rejection. Do not copy, rename, relabel, or upload an
  artifact from another channel.
- Do not modify or discard unrelated dirty-worktree changes.

## Verification

- Run the runtime-profile and release-hook pure Node suites.
- Run syntax checks for the modified release scripts and `git diff --check`.
- Do not invoke package builds, signing, notarization, publication, network operations, Electron,
  Playwright, or E2E. Ral owns the next Stable release run.

## Owner Verification

- Run a Development package and confirm its metadata/artifacts land under `dist/dev/`.
- Run `yarn fast_publish:mac_arm`; confirm its production build repopulates `dist/` and Stable
  publication no longer observes `channel: dev`.

## Delivery

- Implemented the three-way local artifact directory mapping without weakening publication gates.
- Stable publish aliases now build the selected production package before artifact validation and
  upload; fast macOS ARM publish uses the same one-build entrypoint.
- Added Development fixture coverage, direct release-channel directory assertions, and package
  alias source guards.
- Runtime-profile and release-hook suites passed 41/41; `node --check` accepted both modified
  scripts and `git diff --check` passed.
- No build, signing, notarization, upload, CDN refresh, Electron, or E2E ran.
- Runtime release execution remains with Ral.
