# EyesOnAgents Card Context Menu and Codex Archive

Status: implementation in progress

## Problem

Monitor cards expose their actions only through the small `…` button. Right-clicking a card opens
the native Chromium menu instead of the actions the owner expects at that pointer position. The
menu also has no direct way to archive a completed Codex task.

## Resolution contract

- Right-clicking a thread card prevents the native menu and opens the complete existing card menu
  at the pointer.
- Pointer placement is viewport-aware: a left-edge click leaves the menu on its right, a right-edge
  click pulls the menu left, and insufficient bottom space flips the complete menu above. No item
  may be clipped by the card or list overflow.
- The `…` button and right-click share one menu-content component. Open, read/unread, Copy session
  path, disabled/loading rules, labels, and order cannot drift between triggers.
- Opening one trigger closes the other. Scrolling closes the pointer-anchored popup. The `…` button
  remains the visible keyboard path and reports menu/expanded semantics.
- Archive is the last, separated action and is shown only on Codex cards. The action calls the
  official App Server `thread/archive { threadId }` method; provider acknowledgement precedes local
  archive persistence and removal from the snapshot.
- Archive failure keeps the card visible and uses the existing bounded action-error surface.
- Claude cards do not show Archive. Claude Code 2.1.220 and its Hooks have no supported external
  archive mutation, while Claude Desktop's `isArchived` metadata is a private read-only provider
  projection. Bitterless does not edit it or substitute a deletion tombstone.

## Design direction

The subject is a compact desktop agent-session monitor for one owner, and the job is fast triage.
The existing Royal Blue variables, 13px Arco menu typography, card surfaces, spacing, and motion are
retained; no new palette, font, or decorative layer is introduced. The signature interaction is
**one menu, two entrances**: the pointer entry feels native while the visible `…` remains learnable
and keyboard reachable. The deliberate restraint avoids a custom context-menu visual that would
drift from the rest of Bitterless.

## Delivery

[eyes-on-agents-card-context-menu-archive-071](../plan/tasks/eyes-on-agents-card-context-menu-archive-071.md)
