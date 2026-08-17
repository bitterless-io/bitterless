---
id: eyes-on-agents-provider-identity-036
scope: provider-qualified EyesOnAgents persistence and renderer identity without Codex behavior change
status: done
depends-on: [eyes-on-agents-working-start-order-035]
---

# EyesOnAgents Provider Identity

## Objective

Upgrade EyesOnAgents from a provider-blind UUID key to one stable provider-qualified session key so
Codex and Claude can coexist without collision or click/drag/search aliasing.

## Required behavior

- Add provider `codex | claude`, `sessionKey`, archive tri-state, and nullable Claude Desktop ID to
  shared DTOs and strict validators.
- Transactionally and idempotently rebuild every provider-blind EyesOnAgents thread, snapshot, Hook
  receipt, and completion receipt key into provider-qualified form.
- Preserve all existing Codex Domain, runtime, unread, archive, prompt, Open, and receipt state.
- Import valid legacy Claude rows idempotently without dropping or rewriting the legacy table.
- Use `sessionKey` for renderer keys, selection, Open/loading, drag, move, and search stability.
- Keep every existing Codex App Server, Hook, Focus, unread, notification, and Open behavior.

## Expected paths

- `src/shared/eyesOnAgents/**`
- `src/preload/sqlite/dao/eyesOnAgents.*`
- `src/main/eyesOnAgents/**`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/renderer/eyesOnAgents/**`
- `scripts/eyes-on-agents/**`

## Verification

- Migration audit covers empty, current, and retained multi-version fixtures.
- Repository suites prove Codex state survives and provider IDs cannot collide.
- Core/UI suites prove actions and selection use `sessionKey` while Codex deep links are unchanged.
- Run relevant EyesOnAgents tests, node/type checks, production renderer build, and
  `git diff --check`; never launch Electron.

## Review

- Independent review required before task 037 begins.

## Delivery evidence

- Added `sessionKey = <provider>:<uuid>`, `provider`, archive tri-state, and nullable Desktop session
  identity to the shared contract; Claude Desktop IDs accept only normalized `local_<uuid>` values,
  and strict Main XPC Open/Move inputs now accept `sessionKey` only.
- Rebuilt thread, raw snapshot, Hook receipt, and completion receipt tables transactionally around
  provider-qualified keys. Existing Codex rows preserve Domain, runtime, unread, archive, prompt,
  Open, timestamps, and receipts; active retained Claude rows import idempotently as archive
  `unknown` without modifying `coding_agent_session`.
- Constrained every existing App Server/Hook/refresh write to provider `codex`, while renderer
  drag, search selection, loading, Open, and Domain move identity use `sessionKey`.
- Assigned the provider rebuild a new `260817143129` migration/version code so databases already
  stamped by 0.0.69 cannot skip it. `yarn audit:sqlite-migrations` passed all 12 Core retained/fresh
  baselines, including a provider-blind database stamped `260813155645`, plus the other bundled
  migration audits.
- `yarn test:eyes-on-agents:repository`, `yarn test:eyes-on-agents:core`, App Server, bridge,
  Project filter, activation, rendered Project filter, and global search suites passed.
- Identity-related UI source assertions pass. The combined UI source file still has three
  unrelated pre-existing failures for notification construction and two English i18n copy-shape
  assertions; no Electron process was launched.
