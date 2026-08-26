---
id: eyes-on-agents-unread-before-working-order-068-1
target: working-tree-2026-08-26-dev-next
compared_with: eyes-on-agents-unread-before-working-order-068
---

# Verdict

**PASS. No P1, P2, or P3 finding.** The implementation satisfies the unread-before-working order
without demoting user-blocked waits or promoting a working row's latent unread bit.

# Evidence

1. The comparator orders `waiting_approval`, `waiting_input`, visible non-active unread,
   `working`, then ordinary rows.
2. Runtime state, rather than the numeric rank, selects the presentation timestamp: waiting and
   working rows use `statusObservedAt`; unread and ordinary rows use
   `lastActivityAt ?? lastCompletedAt`.
3. Provider-qualified `sessionKey` remains the stable final tie-breaker.
4. The focused test includes multiple activity-ordered unread rows, multiple state-entry-ordered
   working rows, and `working + isUnread`. Search results assert the exact Focus order.

# Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents:ui` | PASS, 71/71 |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `git diff --check` | PASS |
| independent code/test review | PASS, no finding |
| Electron E2E | Not run — owner boundary |

# Owner Runtime Boundary

Ral should verify in the real app that completed unread rows with red dots appear before working
rows, while approval/input waits remain at the top and working rows remain stable during replies.
