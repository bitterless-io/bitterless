---
id: zellij-selection-contrast-001
scope: main/zellij/theme
status: done
depends-on: []
verify: code-and-renderer-passed; owner-package-testing-pending
---

## Objective

Make native and browser text selections clearly visible while preserving terminal appearance.

## Context

[Issue and palette contract](../../issues/zellij-selection-contrast.md).

## Path

`src/main/zellij/zellijDefaultConfig.constant.ts`, configuration defaults if needed, and focused
`tests/zellij/` theme/configuration regressions. Rendered artifact is outside the project repo.

## Verification

Native KDL acceptance and resolved colors, contrast, upgrades, browser rendering and independent
review; no Electron E2E. Leave earlier login-PATH changes and owner build metadata untouched.

Results: focused configuration 23/23; full Zellij 195/195; scoped strict TypeScript and ESLint
passed. [Independent review](../reviews/zellij-selection-contrast-001-1.md): pass.
Actual isolated Zellij native/browser rendering produced a before/after image: selected-region
contrast 1.00 -> 6.79, selected text 7.16; inactive browser selection 4.68/4.94.
No new build or Electron E2E; owner package acceptance remains pending.
