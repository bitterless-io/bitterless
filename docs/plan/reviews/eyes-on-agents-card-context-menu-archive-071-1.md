---
id: eyes-on-agents-card-context-menu-archive-071-1
target: working-tree-2026-09-01-dev-next
compared_with: eyes-on-agents-card-context-menu-archive-071
---

# Verdict

**PASS. No open P1, P2, or P3 finding.** One P2 found during the first pass was fixed and
independently rechecked: repeating right-click on an already open card menu now relocates it to the
new pointer instead of toggling it closed.

# Evidence

1. The `…` and card context-menu Dropdowns render one `ThreadCardMenu`, so capability checks,
   ordering, busy states, labels, and action delegation cannot drift.
2. The context trigger uses pointer alignment, auto-fit, a body popup container, and scroll-close.
   Its controlled repeat-right-click path closes the previous Trigger and replays the preserved
   pointer event after Vue applies the closed state, with a recursion guard.
3. Archive renders only for Codex and delegates through the typed renderer emitter, XPC handler,
   Main service, and Codex App Server supervisor.
4. Main validates a visible Codex identity, serializes with managed App Server activity, sends
   `thread/archive { threadId }`, then persists the existing local archive state and broadcasts the
   row-absent snapshot.
5. Provider rejection, malformed response, Claude/missing identity, and lifecycle cancellation do
   not write local archive state. Store failure retains the row and exposes the existing action
   error.

# Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents:app-server` | PASS |
| `yarn test:eyes-on-agents:core` | PASS |
| focused ThreadCard mounted interaction | PASS, 9/9 |
| focused 071 UI source checks | PASS |
| `yarn typecheck:eyes-on-agents:core` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `git diff --check` | PASS |
| complete UI source suite | 77/78; one unrelated pre-existing notification App ID assertion mismatch |
| independent implementation review and fix recheck | PASS, no open finding |
| Electron E2E | Not run — owner boundary |

# Owner Runtime Boundary

Ral should right-click a card near each viewport edge, repeat right-click at a new position, open
the visible `…` menu, and archive a disposable Codex task. Confirm the popup stays complete, the two
entrances never coexist, the Codex task disappears only after provider success, and Claude offers
no Archive item.
