# Review: External tools initialization and development readiness 174

Date: 2026-09-12

Task: [external-tools-init-dev-ready-174](../tasks/external-tools-init-dev-ready-174.md)

## Findings

No P1/P2 blocking findings in the task-scoped change.

## Contract and integration evidence

- **Initialization reaches the real runtime path.** The distribution contract at
  `docs/features/terminal-zellij-distribution.md:18` is implemented by
  `scripts/maestro/externalTools.cjs:704`: initialize all three stores, then stage the detected
  host before reporting success. The destination is the unpackaged resolver's
  `<app.getAppPath()>/build/maestro-tools` at `src/main/zellij/zellijRuntime.service.ts:46`;
  the final compiled resolver at `out/main/app.main.js:6429` agrees. Packaged resolution remains
  `Resources/maestro-tools`.
- **Reuse authority and download units.** The inventory and pinned hashes have no task diff.
  `scripts/maestro/externalTools.cjs:656` returns before creating temporary directories when a
  complete store validates. Repair at line 581 checks regular files, non-symlink payload parents
  and current inventory SHA-256 values without trusting the old manifest. Lines 670–684 split
  the five binary archives, AnyDoc's four-file JS package, and its native binary into separate
  reuse/download units. Reused payload mtimes are preserved; executable mode is repaired locally.
  Archive digest verification and final exact-tree/manifest validation remain in force.
  `--force` deliberately bypasses these reuse checks.
- **Managed stage replacement and failure handling.** Line 757 validates and returns an already
  correct stage before consulting its cache. Repair validates the source, copies into a sibling
  temporary directory, validates the complete replacement, then uses the existing rollback helper
  at line 609. Source, copy, validation and installation-rename failures retain the previous
  output; temporary directories are cleaned. Whole-directory replacement removes retired
  `manifest.json`/`micromeet` residue only from managed `build/maestro-tools`. No source-removal
  operation is introduced. The behavioral cases at `scripts/maestro/externalTools.test.mjs:484`
  through line 680 cover repeat no-op, granular repair, forged manifests, independent AnyDoc
  units, permissions, symlinks, forced refresh, opposite-platform staging and failure rollback.
- **Offline DEBUG commands and package targets.** `package.json:95`, line 97 and line 100 stage
  the host before their Electron Vite command. `dev:prod` selects `debug_prod` and reaches that
  same preparation path. Stage has no download call; an invalid/missing cache matters only when
  the existing stage needs repair, and the diagnostic requests `yarn tools:init`. Release build
  preparation is unchanged. The supported package entries at lines 113, 116 and 119 retain
  their explicit `win64`, `mac_arm` or `mac_intel` stage/verify sequence after the release build,
  so a previous host/other-target stage cannot satisfy the wrong target. Unpack preparation chooses
  its host at `scripts/prepare-maestro-package-tools.cjs:10`. Builder retains the staged Resources
  copy and `afterPack` hook (`electron-builder.tmp.yml:14`, line 56); the package audit checks
  bundled native-tool architectures against the actual application executable
  (`scripts/package/desktopPackage.audit.cjs:415`, lines 761 and 772). A separate read-only
  packaging-path cross-check found no active consumer of the retired Micromeet stage payload.
- **Fixture boundaries are explicit.** `scripts/environment/externalToolsPreparation.test.mjs:32`
  covers `dev`, `dev:prod`, `build` and `start` through copied real package commands and real
  profile/before scripts. Its CLI adapter supplies a small pinned fixture inventory to production
  initialization/staging exports; Rig environment selection and Electron Vite are stubbed
  (lines 114, 154 and 170). It rejects attempted downloads/external processes and checks the
  runtime path before recording a launcher call. These tests establish command preparation,
  including failure before launch, but are not an Electron startup or native-platform E2E test.

## Independent checks

This review inspected the complete task-scoped diff and new integration test, current task/issue/
feature contracts, runtime resolver, initialization/staging implementations and package wiring.
The prior SQLite-task changes were treated as separate work and were not modified.

Read-only verification against the actual current files passed:

- `validateExternalStore()` for all three real platform caches and
  `verifyStagedExternalTools(projectRoot, 'mac_arm')`, using the production exports and pinned
  inventory. No cache/stage mutation or external binary execution was performed by this review.
- Final package identity `Bitterless_DEBUG_PROD`, version code `260912205944`, and compiled marker
  `debug_prod` / `prod` / `debug` / `prod`. The final build log records host-stage verification
  before compilation and successful completion in 23.37 seconds.
- `git diff --check`; current branch `dev/next` and independent Bitterless Git boundary confirmed.
  No branch operation or sync was performed.

## Inherited verification and limits

The developer/root supplied these results, which this review inspected without repeating the
unchanged suites or initialization runs:

- External-tools behavioral suite: 31/31 passed.
- Runtime/profile/build-preparation suites: 22/22 passed, including the four new command fixtures.
- Two real `yarn tools:init` runs with download invocation blocked/countable: zero attempts,
  all 37 cache files unchanged; the first repaired legacy local staging, and the second preserved
  all 11 staged files' mtimes and inodes.
- Staged Zellij reports `0.45.1`; native default-configuration checks: 3/3 passed.
- Original-profile pure build passed with
  `node scripts/environment/runWithRuntimeProfile.cjs debug_prod -- yarn _build:debug`.
  The root reports that the original `.env.rig` was restored byte-for-byte; this review independently
  inspected the final build log, package metadata and output marker, not the pre-build snapshot.
- Package audit: 34/35 passed. The historical synthetic `afterPack` fixture still lacks
  `packager.appInfo`, as already recorded in
  `docs/issues/tools-init-entry-and-unaudited-packaged-tool-platform.md`.
- Default ESLint remains incomplete: the CJS implementation has the same 40 errors as HEAD;
  the existing external-tools test increases from 10 to 14 explicit-return-type reports due to
  four added plain-JS helpers. Existing semicolon conventions also produce warnings. Scoped lint
  with those convention rules disabled passes, and the new integration test passes its default
  lint configuration. This is not a claim of a clean default lint run or wholly unchanged lint
  output. Syntax checks passed.

No Electron/E2E, Zellij web server/token creation, signed package, publishing, real user database
or credential operation was performed. Native Windows/macOS Intel runtime execution and real
signing remain outside this review; fixture coverage is not represented as those checks.

## Conclusion

**pass** — task 174 meets the initialization, verified reuse and offline preparation contract.
