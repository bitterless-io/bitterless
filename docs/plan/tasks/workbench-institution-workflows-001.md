---
id: workbench-institution-workflows-001
scope: Institution Kimchi workflow library, synchronization and visual Workbench
status: in-progress
depends-on: []
verify: pending
---

## objective

Implement the approved list/detail/flowchart and safe institution workflow synchronization contract. Work on an isolated branch from dev/next; merge and sync dev/next after independent verification.

## context

- ../../features/workbench-institution-workflows.md
- ../../features/kimchi-workflow.md
- ../../INDEX.md

## path

- src/main/ (workflow library/auth integration only)
- src/preload/ (workflow package boundary if required)
- src/shared/ (typed workflow library API)
- src/renderer/ (Workbench Workflow, its styles/stores/i18n)
- tests/ or apps/cowork/tests/ (focused workflow tests)
- docs/features/workbench-institution-workflows.md
- docs/plan/tasks/workbench-institution-workflows-001.md

## verification

Follow the feature contract: real API/storage/parser/UI wiring, focused tests, typecheck/build, rendered visual review, independent source review and verified sample Kimchi execution. No unapproved desktop distribution/restart required.
