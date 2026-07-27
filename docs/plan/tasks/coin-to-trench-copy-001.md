---
id: coin-to-trench-copy-001
scope: user-visible Coin to Trench copy
status: done
depends-on:
  - coin-miniapp-entry-restore-001
---

# Rename visible Coin copy to trench

## Objective

Rename the user-visible Coin Mini Apps entry to `trench` and replace the card subtitle with
`trenchs for trenchers`, while keeping the existing internal `coin` runtime, route, IPC, state, and
file paths stable.

## Context

- `docs/features/coin.md`
- `docs/plan/tasks/coin-miniapp-entry-restore-001.md`

## Path

- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `docs/features/coin.md`
- `docs/INDEX.md`
- `docs/plan/tasks/coin-to-trench-copy-001.md`

## Verification

- `git diff --check`
- Focused source search confirms the removed subtitle no longer exists and both locale Mini App
  entries now expose `trenchs for trenchers`.
- Focused copy check passed:
  `trench copy ok: old subtitles removed; new subtitle present in both locales`.
- `yarn typecheck:web` was attempted and remains blocked by task-unrelated baseline errors in
  connector preload handlers, existing Coin renderer types, poker test globals, old Chat types, XPC
  alias declarations, Maestro/Omni bridge globals, shared EyesOnAgents contract, and path helper
  types.
