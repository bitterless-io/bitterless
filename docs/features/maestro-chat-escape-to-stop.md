# Plain Escape stops the running turn (BL port of cowork's contract)

**Status:** implemented; code-verified — `typecheck:web` unchanged baseline (4 pre-existing
diagnostics, none in the touched files). Human `yarn dev` testing pending.
**Reported:** 2026-09-17 (Ral: "对话进行中时 esc无法触发 stop bl cowork 应该都需要做").
**Area:** `src/renderer/maestro/control/src/ChatPanel.vue`.
**Reference:** cowork's original feature
([`micromeet-cowork/docs/plan/tasks/drill-stop-escape-001.md`](../../../micromeet-cowork/docs/plan/tasks/drill-stop-escape-001.md))
and its 2026-09-17 correction
([`escape-stop-cross-webcontentsview-focus.md`](../../../micromeet-cowork/docs/issues/escape-stop-cross-webcontentsview-focus.md),
[`escape-stop-tooltip-overlay-selector.md`](../../../micromeet-cowork/docs/issues/escape-stop-tooltip-overlay-selector.md)).
This BL port is built directly against the corrected shape, not the original.

## Contract

Plain Escape, while the chat surface and its current session are active, invokes exactly the same
Stop action as the enabled Stop button. Hidden/disabled Stop, idle/stopping chat, another active
session, another app view, key repeat, and IME composition do not trigger a second or unrelated
stop. Existing dismissible overlays (modals, drawers, Arco trigger popups, the context-graph modal,
the response-status roster, the chat error modal) retain their normal Escape behavior and take
priority over stopping the turn.

## What changed

`ChatPanel.vue`:

- `panelRef` — new template ref on the root `.chat-panel` div (mirrors cowork; BL had no ref there
  before).
- `stopEnabled` computed, beside `turnLocked` — `Boolean(session.compacting || (session.turn &&
  (!session.turn.aborting || session.turn.stopError)))`, same as cowork's.
- `escapeStopBlockedByOverlay()` — the overlay scan, built with the tooltip-exclusion fix already
  applied (checking for a real `.arco-tooltip-content` descendant rather than the always-dropped
  `class="arco-tooltip"` cowork's original version wrongly relied on; also treats
  `getComputedStyle(overlay).opacity === '0'` as non-blocking). BL's selector list adds
  `.chat-error-modal` — cowork has no `ChatErrorModal` equivalent.
- `onChatEscapeKeydown()` — the guard chain: plain key, not repeated/composing/already-prevented, no
  modifiers, `document.hasFocus()` + visible + this session is the active one, inside the panel's own
  DOM subtree, no open slash menu, `stopEnabled`, and no blocking overlay. Registered as a plain
  (bubble-phase) `window` keydown listener in the **same** `onMounted`/`onBeforeUnmount` block that
  already registers the existing capture-phase `onPanelKeydown` (⌘/Ctrl+N) — bubble phase so
  dismissible child/document handlers get first refusal at Escape, matching cowork's "run after
  child/document handlers" comment.

## Deliberately NOT ported

- **No drill-confirmation branch.** Cowork's `stop()` opens a confirmation dialog when a site drill
  (`explore_session`) is active, because stopping loses unwritten exploration results. BL has no
  `explore_session`/drill feature wired to its UI today — porting that branch would be dead code.
  `stop()` here calls straight through, same as clicking the existing Stop button already does.
- **No cross-`WebContentsView` broadcast fallback.** Cowork's Control renderer is one of several
  sibling `WebContentsView`s competing for OS keyboard focus (its own live browser/drill output is
  a separate view), which is *why* a plain `window` keydown listener alone was insufficient there —
  see the cross-view-focus issue linked above. BL's Control renderer today has no such competing
  operation/browser view, so the failure mode that fix addresses does not exist here yet; a plain
  `window` listener is the whole mechanism, matching what cowork itself had before yesterday's
  correction. **Revisit this once BL gains its own browser/task-card view that can hold OS focus
  while Control is visible** — at that point this needs the same `before-input-event` → broadcast →
  subscriber shape cowork now has.
- **No UX ruling on a confirmation dialog for a future BL drill feature.** If/when BL gets an
  exploration feature analogous to cowork's drill, whether stopping it via Escape should also prompt
  a confirmation is a product decision for that feature's own design, not assumed here.

## Verify

- `yarn typecheck:web` (surface `renderer/maestro`) — unchanged baseline, 4 pre-existing diagnostics,
  none in `ChatPanel.vue`.
- New test: [`tests/maestro/maestroChatEscape.test.mjs`](../plan/tasks/maestro-escape-stop-182.md) —
  see that task doc for the specific cases.
- Not run: Electron E2E (CLAUDE.md — never run unprompted).
