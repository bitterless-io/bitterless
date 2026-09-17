# Pi skill integration emits an unsupported CommonJS package load

Status: Fixed and code-verified; owner live-startup acceptance pending. Reported by Ral 2026-09-17. Paired scope: Bitterless and Cowork.

## Evidence

Bitterless yarn dev:prod throws ERR_PACKAGE_PATH_NOT_EXPORTED during app load. The installed pi-coding-agent 0.85.1 package exposes the root under the import condition only. The failing pre-fix BL main output and a shared chunk retained require("@earendil-works/pi-coding-agent"), which cannot load that package in Electron's CommonJS entry. The bridge facade exports from the bare package. electron-vite adds that dependency to Rollup’s external set before resolver hooks run, so even enforce: pre cannot intercept the package re-export. The earlier standalone Vite test did not use electron-vite's real dependency externalization and therefore missed this boundary. Cowork uses a virtual skill entry and must be checked under both actual configurations rather than assumed safe.

## Intended behavior and repair

Native SDK skill functions load in dev and production main bundles; full model/session APIs keep their existing dynamic ESM imports. Prevent a bare CommonJS package load through the smallest build integration change; do not alter node_modules or dependency exports. Verify with the real electron-vite main configuration and executable focused CJS fixture, both with externalization enabled, without launching Electron.

Related [task](../plan/tasks/skills-pi-reload-cache-002.md).

## Confirmed repair

Bitterless now references a dedicated `virtual:bitterless-pi-skills` module rather than re-exporting the bare ESM-only SDK package. The bridge resolves a non-package virtual ID before loading installed SDK skill implementation files. A dedicated ambient declaration preserves native types; model/session APIs remain external dynamic imports.

The regression resolves the actual electron-vite main presets, including dependency externalization, for both serve and build. A focused CommonJS artifact executes native discovery, frontmatter parsing and prompt formatting. Both BL modes reproduced the unsupported require before the fix and pass after it. Cowork's existing virtual module passed the same paired checks without a production packaging change. These are compile/runtime-fixture checks, not an Electron GUI startup or packaged-app smoke test.

## Final verification — 2026-09-17

- BL: actual serve/build CJS regressions 2/2 under the debug_prod runtime wrapper. Native skill discovery/parsing/formatting execute successfully. Full build passes, with no bare Pi SDK require in main output.
- Cowork: actual serve/build CJS regressions 2/2 with dev:prod's blank environment settings. Existing virtual entry remains valid; full build passes.
- Cache/lifecycle suites: BL 62/62 plus final native-reload/request-parity 3/3; Cowork 56/56. Related strict TypeScript checks pass.
- These checks did not launch Electron. Ral should rerun yarn dev:prod in each app to confirm live startup. See the task for exact commands and verification limits.
