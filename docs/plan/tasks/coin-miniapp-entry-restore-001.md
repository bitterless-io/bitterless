---
id: coin-miniapp-entry-restore-001
scope: authenticated Home Mini Apps Coin entry
status: done
depends-on:
  - miniapp-entry-visibility-001
---

# Restore Coin Mini Apps entry

## Objective

Restore the Coin card on the authenticated Mini Apps page while leaving Maestro hidden.

## Context

- `docs/features/coin.md`
- `docs/plan/tasks/miniapp-entry-visibility-001.md`

## Path

- `src/renderer/home/src/views/miniApp/miniApps.constant.ts`
- `docs/features/coin.md`
- `docs/plan/tasks/coin-miniapp-entry-restore-001.md`

## Verification

- `git diff --check`
- Source inspection confirms the Mini Apps collection includes `coin` and still keeps `maestro`
  block-commented.
- Focused comment-stripped source check passed:
  `active mini app entries: coin present, maestro hidden`.
- `yarn typecheck:web` was attempted and remains blocked by task-unrelated baseline errors in
  connector handlers, existing Coin renderer types, poker test globals, old Chat types, XPC alias
  declarations, and shared EyesOnAgents/path helper types.
