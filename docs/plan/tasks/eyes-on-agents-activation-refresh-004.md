---
id: eyes-on-agents-activation-refresh-004
scope: refresh EyesOnAgents thread metadata when its window regains focus
status: done
depends-on: [eyes-on-agents-project-filter-003]
---

# EyesOnAgents Window Activation Refresh

## Objective

Refresh the Codex thread list whenever the EyesOnAgents window becomes active again so changed
titles, new threads, Project metadata, and discovery status appear without requiring manual Sync.

## Required behavior

- Subscribe to the renderer window's focus transition and remove the listener on unmount.
- A connected activation runs the existing `syncThreads()` path; no second discovery API is added.
- Auto-connect-enabled `disconnected` or `error` state may retry the same sync path.
- `connecting` / `syncing` activation and explicit disconnected state reload local snapshot data
  without starting a competing operation or overriding explicit disconnect intent.
- Repeated activation while an action is busy must not create overlapping sync requests.
- Keep the current snapshot visible on failure and use the existing error surface.
- Do not add a timer, polling loop, persistence, Electron window process, or native IPC.

## Expected paths

- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `scripts/eyes-on-agents/`
- `docs/integrations/eyes-on-agents.md`
- this task and its review artifact

## Verification

- A focused unit test covers connected sync, auto-connect retry, connecting/syncing coalescing,
  explicit disconnect, and duplicate activation while busy.
- UI source coverage proves the focus listener is installed and removed.
- `yarn test:eyes-on-agents:ui`
- `yarn typecheck:eyes-on-agents:ui`
- `git diff --check`
- Process audit proves no EyesOnAgents test or new Electron helper remains after verification.

## Review

- Round 1: `docs/plan/reviews/eyes-on-agents-activation-refresh-004-1.md` — accepted in the primary
  session without starting another MCP-backed review agent.
