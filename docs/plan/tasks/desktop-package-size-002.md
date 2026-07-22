---
id: desktop-package-size-002
scope: production Electron dependency boundary and pre-sign package-size gate
status: done
depends-on: []
---

# Desktop production package size

## Objective

Remove renderer/build-only dependency duplication from the Electron production archive and add a
pre-sign audit that prevents an oversized or incorrectly composed desktop package from reaching
notarization or upload.

## Context

- `docs/issues/desktop-package-includes-build-only-dependencies.md`
- `docs/features/sqlite-migration-release-gate.md`
- `electron.vite.config.ts`
- `electron-builder.tmp.yml`

## Implementation contract

- Classify direct dependencies from built Main/Preload external imports and dynamic loaders; retain
  all true Electron runtime dependencies.
- Renderer/build/test dependencies remain installed as development dependencies and continue to be
  bundled by Electron Vite.
- Electron Vite may bundle proven pure-JavaScript Main/Preload libraries to avoid shipping their
  complete source trees. Native addons, Playwright runtime discovery, and the lazy Pi agent runtime
  stay external unless a real packaged-runtime test proves otherwise.
- Prevent the private Yarn workspace `@micromeet/cli` from entering `app.asar`; preserve its
  compiled `maestro-tools/micromeet` release resource.
- Electron Builder invokes the package audit with `afterPack`, before signing. The same module also
  supports direct CLI invocation against an existing application bundle.
- The gate uses byte-based limits of 220 MiB for `app.asar` and 650 MiB for the unpacked
  application, and rejects known renderer/build-only package roots.
- The release remains at `0.0.35`; this correction is completed and verified before retrying the
  cancelled release.

## Path

- `docs/INDEX.md`
- `docs/issues/desktop-package-includes-build-only-dependencies.md`
- `docs/plan/README.md`
- `docs/plan/tasks/desktop-package-size-002.md`
- `package.json`
- `yarn.lock`
- `electron.vite.config.ts`
- `electron-builder.tmp.yml`
- `electron-builder.yml`
- `scripts/package/`
- `build/release_note.md`

## Verification

- package audit unit/contract tests
- Main/Preload external-runtime dependency contract check
- `yarn build`
- production-configured unsigned macOS arm64 directory package
- direct package audit against the generated `.app`
- `yarn test:sqlite-migrations`
- `git diff --check`

## Completion — 2026-07-22

- Production dependencies now contain only external Main/Preload runtime roots. Renderer/build
  dependencies remain available to Electron Vite, while selected pure-JavaScript runtime libraries
  are bundled instead of copied as complete package trees.
- Electron Builder excludes tests, temporary output, source maps, and the duplicate
  `@micromeet/cli` workspace. The separately compiled `maestro-tools/micromeet` executable remains.
- `afterPack` and the direct CLI enforce 220 MiB ASAR and 650 MiB application limits, banned roots,
  and AST-derived packaged runtime imports before signing or publication.
- The first independent review found one missing explicit `protobufjs` runtime root. The fix makes
  it a production dependency and adds the AST-derived external-root gate. Round-two review passed
  with no remaining P1, P2, or P3 finding.
- The focused package tests passed 9/9, SQLite release tests passed 11/11, the production build
  passed, and a clean committed macOS arm64 package passed at 209.75 MiB ASAR / 544.70 MiB app. See
  [`desktop-package-size-002-1`](../reviews/desktop-package-size-002-1.md) and
  [`desktop-package-size-002-2`](../reviews/desktop-package-size-002-2.md).
