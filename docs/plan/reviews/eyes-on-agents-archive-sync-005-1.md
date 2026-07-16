# Review: eyes-on-agents-archive-sync-005 (round 1)

## Conclusion

**pass** — EyesOnAgents now removes archived Codex threads and restores unarchived threads while
retaining Domain, Project, completion, and opened/read metadata.

This review was performed in the primary session without a separate review agent so verification
would not initialize another Bitterless MCP Electron helper.

## Contract review

- The managed App Server explicitly pages `thread/list` with `archived: false` and `archived: true`;
  both paths keep the existing page and entry limits.
- Active inventory upserts clear stale archive flags. The archived inventory marks only explicit,
  valid thread IDs after active upserts, so archived evidence wins an overlapping race.
- `thread/archived` hides a known row immediately. `thread/unarchived` restores retained state
  immediately and then performs a full reconciliation so unknown rows and current metadata arrive.
- Archived rows remain in SQLite and are excluded only at snapshot read time. Archive transitions
  clear transient active evidence without changing Domain, Project, completion, or opened markers.
- Desktop-owned archive changes do not depend on cross-process notifications: the existing window
  activation refresh reconciles both inventories from the shared Codex thread store.
- No polling, transcript access, archive mutation control, hard deletion, native IPC, or Electron
  test launch was added.

## Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents:app-server` | pass |
| `yarn test:eyes-on-agents:repository` | pass |
| `yarn test:eyes-on-agents:core` | pass |
| `yarn typecheck:eyes-on-agents:core` | pass |
| `git diff --check` | pass |
| Process audit | pass after cleaning current Codex-owned MCP helpers; no test/LFS/push process remained |
