---
id: eyes-on-agents-focus-acknowledgement-024-1
target: working-tree-2026-07-23
compared_with: eyes-on-agents-focus-acknowledgement-024
---

# Verdict

**PASS. No open P1, P2, or P3 finding remains.**

# Evidence

- The tiered `thread/read` projection no longer reads `status`; its internal patch type and strict
  repository parser no longer admit a runtime field.
- `refreshThreadPage` selects and writes only title, monotonic provider activity, and the separately
  authorized latest-user-prompt fields. It cannot update runtime, status ownership/watermarks,
  active turn, or unread.
- DAO and Main derive Focus from the same persisted rule: unread always focuses; otherwise an
  active runtime focuses only when it has not been opened or its status observation is newer than
  the successful Open timestamp.
- Existing deep-link ordering remains unchanged: `markOpened` runs only after `openExternal`
  resolves. A subsequent Hook `turn_started` records newer working attention and returns the row to
  Focus.
- No paused state, elapsed-time expiry, or private rollout/transcript inference was introduced.

# Verification

- `yarn test:eyes-on-agents:core` - PASS.
- `yarn test:eyes-on-agents:repository` - PASS.
- `yarn test:eyes-on-agents:app-server` - PASS.
- `yarn test:eyes-on-agents:bridge` - PASS.
- `yarn test:eyes-on-agents:project-resolver` - PASS.
- Independent source review - PASS, no P1/P2/P3 finding.

# Boundary

No Electron UI was launched. Ral owns final observation against a real Codex task. Existing strict
typecheck failures outside the changed paths remain recorded in the delivery handoff.
