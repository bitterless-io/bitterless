---
task: release-preview-mac-arm-auto-cut-115
review: 1
status: passed
---

# Preview macOS ARM auto-cut independent review 1

## Result

Passed with no P0, P1, P2, or P3 finding.

## Evidence

- `publish_preview` delegates to `publish_preview:mac_arm`.
- The macOS ARM command preserves locked install and has exactly one `--bump` before `--build`.
- Preview Intel/Windows and all Stable/development publisher aliases do not bump; `release:cut`
  remains `node scripts/patch.js`.
- `scripts/publish.js` executes bump before migration audit, remote preflight, and build.
- The unrelated current package name is preserved and `_version`, `version`, and `version_code`
  remain `0.0.84`, `0.0.84`, and `260901164356`.

## Verification

- Release-hook tests: 37/37 passed.
- `node --check scripts/publish.js`: passed.
- Task-scoped diff checks: passed.
- Patch, build, publish, network, Electron, and E2E commands were not run.
