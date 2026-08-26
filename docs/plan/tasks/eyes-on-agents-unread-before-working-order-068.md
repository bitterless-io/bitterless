---
id: eyes-on-agents-unread-before-working-order-068
scope: place visible unread-dot sessions ahead of working sessions without demoting human-blocked waits
status: implemented; owner verification pending
depends-on: [eyes-on-agents-working-start-order-035, eyes-on-agents-unknown-dot-session-path-066, eyes-on-agents-search-modal-067]
---

# EyesOnAgents Unread Before Working Order

## Objective

Make completed attention easier to notice: a session showing the red unread dot must sort before a
session showing the working loader. Waiting for approval and waiting for user input remain the two
highest priorities because they are blocked on the user.

## Required behavior

The single Focus/search comparator becomes:

1. `waiting_approval`;
2. `waiting_input`;
3. visible unread-dot sessions — `isUnread = true` and runtime is non-active (`idle`, `failed`,
   `ended`, or `unknown`);
4. `working`, whether its unread flag is latent or already acknowledged;
5. every other visible session.

- Working, approval, and input rows continue to show the loader rather than the red dot. A latent
  unread bit on `working` must not accidentally promote it into the visible-dot tier.
- Active ranks continue to sort by `statusObservedAt` descending, so replies and metadata refreshes
  cannot churn them.
- Visible unread-dot and ordinary ranks continue to sort by
  `lastActivityAt ?? lastCompletedAt` descending.
- Provider-qualified `sessionKey` remains the final stable tie-breaker.
- Modal search results reuse the same `focusThreads` ordering and therefore mirror the board.
- No persistence, unread mutation, runtime observation, notification, Open, search-matching, or
  provider behavior changes.

## Expected paths

- `docs/INDEX.md`
- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/issues/eyes-on-agents-working-order-churn.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `scripts/eyes-on-agents/focus-board-store.test.mjs`

## Verification

- The focused store test proves approval/input → visible unread dot → working → ordinary order.
- The test uses `working + isUnread` to prove its latent unread bit does not enter the dot tier.
- Multiple unread rows remain activity-ordered; multiple working rows remain state-entry-ordered.
- Modal search preserves exactly the same order.
- `yarn test:eyes-on-agents:ui`
- `yarn typecheck:eyes-on-agents:ui`
- Electron E2E is not run; Ral performs the visual check.

## Result

Implemented. The shared Focus/search comparator now keeps approval and input waits highest, places
non-active unread rows ahead of working rows, and leaves a working row in the working tier even
when its unread bit is latent. Timestamp selection is based on runtime activity rather than the
numeric rank, so waiting/working rows retain `statusObservedAt` ordering while unread and ordinary
rows retain activity ordering.

[Independent review 1](../reviews/eyes-on-agents-unread-before-working-order-068-1.md) passed with
no findings. The focused EyesOnAgents UI suite passed 71/71, the EyesOnAgents UI typecheck passed,
and whitespace validation passed. Electron E2E was not run; Ral owns the real-app visual check.
