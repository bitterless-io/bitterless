# Review: eyes-on-agents-activation-refresh-004 (round 1)

## Conclusion

**pass** — Window focus now refreshes current Codex discovery metadata, including renamed thread
titles, while respecting explicit disconnect intent and preventing overlapping activation syncs.

This review was performed in the primary session without a separate review agent so verification
would not initialize another Bitterless MCP Electron helper.

## Contract review

- `App.vue` installs one top-level `window.focus` listener at mount and removes that exact listener
  before unmount.
- Connected activation and auto-connect-enabled recovery reuse `syncThreads()`; no new API, timer,
  polling loop, native IPC, or persisted state was added.
- `connecting`, `syncing`, initial-load, and explicitly disconnected states use the coalesced quiet
  snapshot path instead of starting a competing connection operation.
- The existing `busyAction` guard drops overlapping focus requests. Failed sync retains the last
  valid snapshot and records the existing action error.
- App Server discovery already maps `name ?? preview` into `title`, and the repository upsert updates
  a non-null discovered title, so the activation sync reflects Codex title changes.

## Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents:ui` | pass: 18 tests, including 9 activation behavior cases |
| `yarn typecheck:eyes-on-agents:ui` | pass |
| `git diff --check` | pass |
| Temporary build directory audit | pass: no activation/render test directory remains |
| Process audit | pass: no EyesOnAgents test process or current Codex-owned Electron helper remains |

The two remaining Bitterless MCP helpers belong to independent active Claude sessions and were not
modified by this delivery.
