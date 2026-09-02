---
id: onlypreview-auxiliary-main-io-086
scope: Remove OnlyPreview window-state, Agent Guide/shim and diagnostic persistence I/O from Main
status: superseded by clarified large-content-only boundary
depends-on: [onlypreview-preview-stream-preload-085]
verify: persistence/guide/log boundary tests, typecheck/lint/build; no Electron/Playwright/E2E
---

# Retain bounded auxiliary OnlyPreview persistence in Main

## Objective

Record the withdrawn migration. Window-state persistence, Agent Guide/shim inspection and
diagnostic logging are small bounded operational/configuration I/O and remain unchanged.

## Context

- [`onlypreview-main-filesystem-io.md`](../../issues/onlypreview-main-filesystem-io.md)
- [`onlypreview-main-filesystem-preload-migration.md`](../analysis/onlypreview-main-filesystem-preload-migration.md)

## Contract

- Do not change the existing window-state/configuration persistence path.
- Do not migrate the small fixed Agent Skill/shim workflow.
- Do not replace the existing logging path solely to eliminate Main filesystem APIs.
- Task 087 verifies only potentially large project-content I/O and must allowlist these bounded
  operational paths.

## Verification

- Confirm the abandoned Auxiliary runtime is absent and existing window/Guide/logging wiring is
  preserved. No Electron/E2E.

## Delivery

Superseded before completion after Ral clarified that only potentially heavy file I/O must leave
Main. No Task 086 production change is delivered.
