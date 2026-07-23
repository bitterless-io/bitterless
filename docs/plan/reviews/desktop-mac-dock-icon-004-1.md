---
id: desktop-mac-dock-icon-004-1
target: working-tree-2026-07-23
compared_with: desktop-mac-dock-icon-004
---

# Verdict

**PASS after resolving one P2 release-gate finding. No open P1, P2, or P3 finding remains.**

# Finding resolved

- **P2:** The first implementation proved the source artwork and runtime wiring but did not make
  that proof a mandatory release gate or inspect the packaged resources. The final implementation
  registers the source test, runs it from `signedBuild` before Electron Builder, and makes the
  existing `afterPack` audit reject missing, empty, or structurally invalid macOS `app.png` and
  `icon.icns` files.

# Evidence

- Electron Builder explicitly uses `build/icon.icns` and copies canonical `build/icon.png` to the
  packaged `Contents/Resources/app.png` location.
- macOS GUI startup applies the development or packaged PNG before Home starts. Helper modes skip
  the operation, and missing/invalid runtime artwork logs a warning without blocking Home.
- The ICNS and ICO generated from the canonical PNG remain pixel-identical to that source.
- The source gate executes before Electron Builder; the packaged-resource gate executes through
  the registered `afterPack` audit before signing/upload.

# Verification

- `yarn test:desktop-app-icon` - PASS, 4/4.
- `yarn test:desktop-package-audit` - PASS, 18/18.
- `yarn audit:sqlite-migrations` - PASS across retained Core, Maestro, and Todoist baselines.
- `yarn test:sqlite-migrations` - PASS, 11/11 release-hook checks.
- Independent source review - initial P2 resolved; final review found no remaining P1/P2/P3 issue.

# Boundary

No Electron UI, package, signing, notarization, upload, or publication was run. Ral explicitly
cancelled packaging and owns final Dock visual verification.
