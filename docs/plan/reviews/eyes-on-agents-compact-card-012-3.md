# EyesOnAgents Idle-Unread Presentation Review — Round 3

Status: accepted

Date: 2026-07-20

## Conclusion

**Pass.** The unread dot and the Open control's unread accessibility context now share one exact
presentation condition: persisted `isUnread` must be true and the effective renderer runtime state
must be `idle`. Working cards show only the title-side loader; waiting, failed, ended, and unknown
cards show neither the dot nor unread wording on Open.

The existing runtime pipeline can produce the intended state: a normal start becomes
`working + unread`, and a successful completion becomes `idle + unread`, which makes the dot appear.
A successful Open still clears persisted unread after the Codex deep link resolves. SQLite
persistence, Focus derivation, compact dimensions, tooltip/ARIA contracts, and card interactions
were not changed. No P1, P2, or P3 finding was found.

## Findings

No open P1, P2, or P3 finding remains.

## Static contract assessment

- `showUnreadDot` is a reactive computed value requiring both `thread.isUnread` and
  `thread.runtimeState === 'idle'`. The dot uses only that value, and `openAriaLabel` uses the same
  value before appending localized unread text
  (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue:52-56,128-132`). There is no
  remaining direct `v-if="thread.isUnread"` presentation path.
- The title loader remains independently gated by exact `runtimeState === 'working'` and remains
  12px (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue:14-21`). Because the dot
  requires exact `idle`, working, waiting approval/input, failed, ended, and unknown are all
  excluded without reserving another status element.
- The runtime repository maps `turn_started` to `working`, successful `turn_completed` to `idle`,
  failed completion to `failed`, and interrupted/cancelled completion to `ended`
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:231-237`). Active events and every completion set
  `is_unread = 1`; the completion update persists its mapped runtime state and unread together
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:239-267,293-318`).
- App Server notifications create `turn_started` and `turn_completed` repository events, with
  provider success/failure/interruption normalized before persistence
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:128-135,1169-1204`). The trusted Hook path likewise
  maps prompt submission to start and normal Stop to successful completion
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:1360-1405`). A standard reply lifecycle therefore
  changes presentation from the working loader to the idle-unread Open dot.
- Effective runtime-state normalization changes stale active evidence only; non-active `idle`,
  `failed`, `ended`, and `unknown` states pass through unchanged
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:186-218`). The renderer condition therefore sees
  the persisted successful-completion `idle` state rather than losing it at snapshot projection.
- `openThread` still awaits `openExternal` before calling `markOpened`, and `markOpened` still sets
  `is_unread = 0` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:1021-1030`;
  `src/preload/sqlite/dao/eyesOnAgents.dao.ts:669-681`). Failed deep-link opening cannot clear
  unread; a successful Open returns and applies the refreshed snapshot.
- Focus remains derived as active runtime state **or** persisted unread, both in repository and
  effective main-process snapshots (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:181-184`;
  `src/preload/sqlite/dao/eyesOnAgents.dao.ts:129-155`;
  `src/main/eyesOnAgents/eyesOnAgents.service.ts:253-278`). The renderer-only visibility condition
  does not mutate or reinterpret persistence or Focus membership.
- The round-2 action dimensions remain Folder/Open/More 10px/9px/12px with 20×20px folder/button
  boxes. Double-click exclusion, card Enter, controls Enter isolation, Open loading/disabled state,
  move menu, relative-time clock, and reduced-motion behavior are unchanged.
- The unread dot remains absolutely positioned at the Open control's upper-right with `top: -2px`
  and `right: -2px` (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less:104-117`).
- The source guard pins the exact idle-unread computed expression, requires both the dot and Open
  label to use it, rejects the former direct unread `v-if`, and retains its loader, size,
  interaction, accessibility, and reduced-motion assertions
  (`scripts/eyes-on-agents/ui-source.test.mjs:198-285`).
- The task and layout documents consistently distinguish persistent unread/Focus from its compact
  visual presentation and document the working → successful idle-unread transition
  (`docs/plan/tasks/eyes-on-agents-compact-card-012.md:33-54,72-82`;
  `docs/integrations/eyes-on-agents-layout.md:79-82,156-186,195-240`).

## Verification

Per owner instruction, this review ran no tests, build, formatter, typecheck, or Electron process.
The assessment used only the updated task/layout, renderer component and source guard, and static
inspection of the existing App Server/Hook event normalization, SQLite runtime mapping, Open path,
and Focus derivation. Only this round-3 review document was added by the reviewer.
