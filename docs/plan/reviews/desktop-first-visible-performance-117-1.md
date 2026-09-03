# desktop-first-visible-performance-117 — independent review 1

Status: passed after findings were fixed

## Scope

- Maestro primary/background readiness split and Settings bundle loading
- Omni native first-visible versus local renderer readiness
- OnlyPreview Shell first-visible and restored-Project index kickoff
- focused source/behavior regressions and non-Electron build verification

## Findings and resolution

The first pass found two blockers:

- **P1:** Omni and OnlyPreview could focus the window a second time when renderer readiness arrived,
  restoring or stealing focus after the user had switched away. Cold startup now records that the
  graph was already presented; readiness completion only settles loading/diagnostics. Existing/reuse
  Omni Open still focuses normally.
- **P2:** Maestro used `Promise.allSettled()` but discarded rejected optional startup results, so a
  missing Control/Workbench/Home could produce a successful boot terminal. Background failure now
  rejects the observed background promise, records fixed failure/pending diagnostics, and never
  destroys the already usable primary window.

The re-review found no remaining P0--P3 issue.

## Verification

- Maestro focused tests: 16/16 passed.
- Omni tests: 55/55 passed.
- OnlyPreview focused tests: 28/28 passed.
- `yarn typecheck:node`: passed.
- directed Web `vue-tsc`: passed.
- `node scripts/maestro/check-cli-integration.mjs`: passed.
- Preview-profile production Electron-Vite build: passed (Main 1388, Preload 1065, Renderer 10520
  modules).
- `git diff --check`: passed.
- `package.json` remained byte-identical across the final build.

Electron/E2E, Playwright, packaged smoke, signing, and a real app launch were not run; Ral owns live
Preview acceptance.
