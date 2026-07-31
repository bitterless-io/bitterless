# EyesOnAgents Working Start Order 035 — Review 1

## Findings

No P1, P2, or P3 findings.

## Conclusion

**pass**

The implementation matches the task and layout contracts:

- `attentionRank` preserves `waiting_approval > waiting_input > working > unread > ordinary`.
- Active ranks read only `statusObservedAt`; missing or invalid values become zero and never fall
  back to message activity.
- Non-active ranks preserve `lastActivityAt ?? lastCompletedAt` descending.
- Equal rank and timestamp comparisons end with immutable `threadId` ascending.
- Focus, All, custom Domains, and global search all consume the same comparator.
- Advancing only `lastActivityAt` leaves working order unchanged, while a changed
  `statusObservedAt` can legitimately reorder the task.
- The SQLite hot/cold activity order and all persistence, polling, App Server, and Hook behavior
  remain outside this renderer-only change.

Contract evidence:

- `docs/plan/tasks/eyes-on-agents-working-start-order-035.md:22`
- `docs/integrations/eyes-on-agents-layout.md:330`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:24`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:38`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:46`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:107`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:121`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:145`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:195`
- `scripts/eyes-on-agents/global-title-search.test.mjs:256`
- `scripts/eyes-on-agents/global-title-search.test.mjs:347`
- `scripts/eyes-on-agents/global-title-search.test.mjs:410`

## Verification

- `yarn test:eyes-on-agents:ui` — passed, 50/50 tests.
- `node --test scripts/eyes-on-agents/global-title-search.test.mjs` — passed, 13/13 tests.
- `git diff --check` — passed.
- `yarn typecheck:eyes-on-agents:ui` — could not complete because the unchanged
  `src/renderer/eyesOnAgents/src/contextBridge/eyesOnAgentsEnv.bridge.ts:1` cannot resolve the
  existing `@preload/eyesOnAgents/eyesOnAgents.preload` alias under the focused UI tsconfig. The
  failure is outside task 035; the real Store harness successfully bundles, type-transpiles, and
  executes the touched Store.

No Electron process or UI automation was launched.

## Human Electron verification

Ral should verify the pointer-stability scenario in the running EyesOnAgents window:

1. Keep at least two tasks in the same active rank.
2. Let the older task receive additional reply activity and confirm neither card moves.
3. Start a genuinely newer working state and confirm that task may move ahead.
4. Confirm waiting-for-approval, waiting-for-input, unread, and ordinary groups retain their
   existing priority order.
