---
id: eyes-on-agents-card-context-menu-archive-071
scope: pointer-anchored shared thread-card menu and provider-authoritative Codex archive action
status: in-progress
depends-on: [eyes-on-agents-archive-sync-005, eyes-on-agents-search-close-after-open-070]
---

# EyesOnAgents Card Context Menu and Codex Archive

## Objective

Make card actions available at the owner's right-click position without duplicating menu content,
and add a real Codex Archive action that hides the task only after provider success.

## Required behavior

1. Extract one shared card-menu content component and render it from both the existing `…` click
   Dropdown and a card-level context-menu Dropdown.
2. The context Dropdown uses pointer alignment, viewport auto-fit, body teleport, and scroll-close.
   It opens mainly rightward near the left edge, mainly leftward near the right edge, flips above
   near the bottom, and exposes every item without card/list clipping.
3. Control both popup states. Opening either closes its sibling; selecting an action closes the
   active popup. The `…` button retains visible focus and explicit menu/expanded accessibility.
4. Add **Archive** last with an Archive icon and restrained separator. Render it only for Codex;
   Claude menu content remains Open/read/path only according to existing capabilities.
5. Extend the Codex App Server supervisor with strict `thread/archive { threadId }` request and
   empty-object response validation.
6. Add a typed `archiveThread({ sessionKey }) -> snapshot` XPC action. Main accepts only a visible
   Codex session, serializes it against background App Server work, ensures a managed connection,
   requests provider archive first, then reuses the existing repository archive mutation,
   broadcasts, and returns the row-absent snapshot.
7. Provider rejection, connection/lifecycle cancellation, invalid/Claude identity, or malformed
   response must not write local archive state. Renderer keeps the row and exposes `actionError`.
8. The provider notification and later full Sync remain idempotent repair. No migration, Claude
   metadata write, deletion tombstone, archived transcript read, or unarchive UI is added.

## Expected paths

- `docs/INDEX.md`
- `docs/issues/eyes-on-agents-card-context-menu-archive.md`
- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/codexAppServer.supervisor.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- focused EyesOnAgents App Server, core, store, and mounted UI coverage

## Verification

- App Server test proves the exact archive method/params, empty success, malformed response,
  provider error, and disconnected rejection.
- Core test proves provider-before-repository ordering, success disappearance/broadcast, Claude and
  missing-row rejection, provider failure with no local mutation, and lifecycle fencing.
- Store test proves success snapshot application, failure retention plus action error, and busy
  duplicate protection.
- Mounted/source UI coverage proves right-click pointer alignment and fit configuration, sibling
  popup exclusion, shared menu parity, Codex-only Archive, and action delegation.
- `yarn test:eyes-on-agents:app-server`
- `yarn test:eyes-on-agents:core`
- `yarn test:eyes-on-agents:ui`
- `yarn typecheck:eyes-on-agents:core`
- `yarn typecheck:eyes-on-agents:ui`
- `git diff --check`
- Electron E2E is not run; Ral performs the real-app pointer/focus/provider check.

## Result

Pending implementation and independent verification.
