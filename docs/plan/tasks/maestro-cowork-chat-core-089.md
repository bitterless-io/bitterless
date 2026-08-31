---
id: maestro-cowork-chat-core-089
scope: Maestro Turn, steering/retry, response status, task timeline, and confirmation parity with Cowork 67b056b
status: pending
depends-on: []
verify: source inspection, task-scoped diff check, independent review; no tests/typecheck/lint/build/Electron/E2E/network
---

# Migrate current Cowork chat core into Maestro

## Objective

Backport the stable chat-core behavior from Cowork `67b056b` without overwriting Maestro-specific
Control, provider, persistence, styling, or host-window behavior.

This task supersedes the older piecemeal `maestro-turn-steering-073` and
`maestro-turn-steering-renderer-074` implementation plans: current Cowork steering is part of the
Turn/status/task model and must land as one call chain.

## Context

- `docs/plan/analysis/maestro-cowork-chat-parity.md`
- `docs/issues/maestro-control-chat-behind-cowork.md`
- `docs/features/maestro.md`
- `docs/features/maestro-turn-steering.md`
- `docs/features/maestro-context-compaction.md`
- `../micromeet-cowork/apps/cowork/src/{renderer/control,main,shared}` at `67b056b`

## Path

- `src/renderer/maestro/control/src/{ControlApp,ChatPanel,MessageItem,MessageList}.{vue,less}`
- `src/renderer/maestro/control/src/{ResponseStatus.vue,task/**,store/**}`
- `src/shared/maestro/{coach,maestroChat,task}.api.ts`
- `src/main/maestro/{agent/**,tasks/**,xpc/**,windows/main/**}`
- `src/preload/maestro/sqlite/**`
- Maestro schema/migrations and directly required registration files
- task-scoped Maestro guard scripts only when the migrated source contract requires them

## Contract

- Replace scattered `busy` state with one reactive per-session Turn while retaining the existing
  single-active-session boundary.
- Create assistant segments lazily on first text/tool activity; seal the current segment before a
  task, confirmation, or other timeline entry so chronological order remains truthful.
- Permit text and voice steering during a live Turn. `steer`/`followUp` is selected in Main, a
  successful merge uses explicit `mergedIntoTurn`, and failed delivery preserves/reports the user's
  text. Stop and Send coexist.
- Show one fixed ResponseStatus above the composer for phase, latest action, retry, task, waiting,
  stalled, and steering state. Do not add a duplicate Stop control.
- Persist task and confirmation snapshots as independent message types. The composer-adjacent
  confirmation sheet is the only live answer control; historical cards are read-only.
- Keep attachments, workspace controls, provider/model/effort, and new-session actions locked during
  a Turn. Preserve Maestro Local/Claude configuration and provider invalidation behavior.
- Preserve replay cards, i18n bootstrap, `source: 'cowork'` compatibility values, `CoachXpcHandler`,
  `coach/*` channels, and `MaestroChatDao` naming.
- Preserve the existing Maestro compaction implementation and its deferred feature contract. Adapt
  new Turn call sites around `compactSessionIfNeeded`; do not introduce Cowork `ContextService`,
  compaction handlers, or usage ledger in this task.
- Port the white transcript, neutral assistant surface, semantic human/error surfaces, three visible
  activity rows, and scroll-to-latest behavior through Maestro's sibling Less/BEM files. Do not add
  Tailwind or Cowork's `#165dff` literals.
- Do not restore Connector, Demo, CRMS fixed-tab/login/avatar/profile, ChannelPicker,
  AppStatusOverlay/bootGuard, or Cowork's standalone application lifecycle.
- Preserve unrelated current-worktree changes.

## Verification

- Inspect each renderer/shared/Main/DAO path as a complete call chain and compare it with Cowork
  `67b056b`.
- Run task-scoped `git diff --check` and an independent source review for P1/P2 defects.
- Do not run tests, typecheck, lint, build, Electron, Playwright/E2E, application launch, or network
  probes. Ral performs E2E after handoff.
