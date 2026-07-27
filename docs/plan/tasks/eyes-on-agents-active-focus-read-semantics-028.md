---
id: eyes-on-agents-active-focus-read-semantics-028
scope: decouple active Focus membership from unread acknowledgement
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-read-all-021, eyes-on-agents-focus-acknowledgement-024]
---

# EyesOnAgents Active Focus and Read Semantics

## Objective

Keep every active or not-yet-resolved Codex task in Focus while `Open` and `Read all` clear confirmed
terminal unread attention. Preserve the existing evidence-based Hook and ten-second refresh paths.

## Required behavior

- Derive Focus as `active runtime OR is_unread`; do not gate active membership on
  `status_observed_at` versus `last_opened_at`.
- Keep `last_opened_turn_id` and `last_opened_at` as successful deep-link evidence, but use neither
  field to hide a still-active task.
- A successful `Open` clears unread only for a confirmed `idle`, `failed`, or `ended` task. It still
  records `last_opened_*` for every successful deep link. Active and `unknown` rows retain latent
  unread attention so an authority gap cannot remove a possibly running task.
- Focus `Read all` is enabled whenever a confirmed terminal Focus task is unread and atomically
  clears `is_unread` only for non-archived `idle`, `failed`, and `ended` rows. It must not mutate
  runtime, Open evidence, activity ordering, or archived rows.
- A later accepted lifecycle event may set unread again. No elapsed-time inference, new polling
  interval, optimistic runtime state, or Electron UI change is introduced.

## Expected paths

- `docs/issues/eyes-on-agents-active-focus-read-semantics.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Core contract coverage proves unread=false active states remain focused regardless of Open time,
  while unread=false inactive states do not.
- Repository coverage proves Open preserves active/unknown attention while recording Open evidence,
  clears confirmed terminal attention, and `Read all` uses the same terminal allowlist without
  changing runtime or `last_opened_*`.
- Renderer source coverage proves the action eligibility uses the same terminal allowlist.
- Run the EyesOnAgents non-Electron suites, Node typecheck, and `git diff --check`. Ral owns runtime
  verification in Electron.

## Delivery evidence

- Re-delivered on 2026-07-27. The source that
  [round 1](../reviews/eyes-on-agents-active-focus-read-semantics-028-1.md) passed on 2026-07-25 was
  never committed — `git log --all -S` finds it in no reachable ref and the sibling worktrees are
  clean — so this task was re-implemented from the issue and task contracts. See
  [round 2](../reviews/eyes-on-agents-active-focus-read-semantics-028-2.md).
- `isEyesOnAgentsFocused(runtimeState, isUnread)` no longer accepts `status_observed_at` or
  `last_opened_at`; `isEyesOnAgentsTerminal` is the single `idle`/`failed`/`ended` allowlist shared
  by Open, `Read all`, and the renderer action gate.
- `markOpened` always writes `last_opened_turn_id` and `last_opened_at` and clears `is_unread` only
  for a terminal row; `markAllRead` switched from the negative active list to the same positive
  allowlist, so `unknown` rows keep their latent marker.
- The renderer derives `focusThreads` in memory through the shared predicate instead of the
  snapshot's `isFocused` flag.
- `yarn test:eyes-on-agents` passes (core, project resolver, repository, App Server, bridge and hook
  delivery, project filter, UI source — 35 UI assertions). `yarn typecheck:node` passes and
  `yarn build` succeeds. `yarn typecheck:web`, `typecheck:eyes-on-agents:core`, and
  `typecheck:eyes-on-agents:ui` still report their pre-existing failures in
  `codexHookBridge.contract.ts`, `pathMain.helper.ts`, `omniWindow`, `maestro`, and
  `eyesOnAgentsEnv.bridge.ts`; none are in the changed files and all reproduce on a clean tree.
- No Electron UI run; Ral owns final runtime verification.
