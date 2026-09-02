---
id: onlypreview-main-fs-boundary-audit-087
scope: Final data-path proof that potentially large OnlyPreview project-content I/O stays out of Main
status: implemented
depends-on: [onlypreview-preview-stream-preload-085]
verify: full focused suite, Main reachability guard, typechecks/lint/build; no Electron/Playwright/E2E
---

# Prove the OnlyPreview large-content Main boundary

## Objective

Audit production project-content paths and prove that every potentially large filesystem payload is
opened, read, streamed or mutated inside a trusted preload while current behavior remains
integrated.

## Contract

- Target/open/restore, Project actions/Delete and every preview adapter/protocol cross real
  capability-bound preload implementations without stubs or whole-file Main buffers.
- Source guards follow project-content call paths and enforce byte/frame ceilings. They must allow
  the existing small bounded window-state/settings, Agent Skill/shim and logging persistence.
- Guards distinguish native OS actions, app-bundle/config loading and bounded operational writes
  from project-content reads; they cannot pass or fail by checking filenames/imports alone.
- The issue and feature ledger close only after focused integration tests, typechecks, lint,
  production build and independent review pass.

## Verification

- Run the complete non-E2E OnlyPreview focused suite plus source reachability checks.
- Run directed Node/Web typechecks, lint, production build and output inspection.
- Do not run Electron, Playwright/E2E, packaged smoke or launch the application; Ral owns the final
  runtime acceptance.

## Delivery

Implemented and independently reviewed PASS. The final audit proves that Project authority/Delete,
generic Preview Read, HTML/assets/PDF/media and Office package bytes are owned by the hidden
`fileSearch` preload. Main exact-validates private envelopes and relays at most one accepted
512 KiB frame at a time; Office additionally caps the complete admitted package at 25 MiB and
fences late prepare/open/read responses across cancellation, workspace replacement and runtime
stop.

The complete serial non-E2E OnlyPreview suite passed 532/532, the independent focused boundary
suite passed 46/46, `yarn typecheck:node`, targeted ESLint, the production build and task-scoped
`git diff --check` passed. `yarn typecheck:web` remains blocked by pre-existing errors outside
OnlyPreview. Electron, Playwright, packaged smoke and E2E were not run, as required.

Task 086 remains superseded because the clarified boundary covers only potentially large
project-content I/O; bounded configuration, window-state, Agent Skill/shim and logging persistence
remains unchanged. See
[independent review 1](../reviews/onlypreview-main-fs-boundary-audit-087-1.md).
