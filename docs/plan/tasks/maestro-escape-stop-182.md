---
id: maestro-escape-stop-182
scope: Port cowork's Escape-to-Stop contract into bl's ChatPanel.vue
status: in-progress
depends-on: []
verify: focused types, new behavioral test, source review
---

## objective

Implement the contract in [the feature doc](../../features/maestro-chat-escape-to-stop.md): plain
Escape, while the chat surface and its current session are active, invokes the same Stop action as
the enabled Stop button, without disturbing dismissible overlays, another session, key repeat, or
IME composition.

## context

- docs/INDEX.md
- docs/features/maestro-chat-escape-to-stop.md
- micromeet-cowork/docs/plan/tasks/drill-stop-escape-001.md (source feature)
- micromeet-cowork/docs/issues/escape-stop-cross-webcontentsview-focus.md (2026-09-17 correction —
  this port is built against the corrected shape)
- micromeet-cowork/docs/issues/escape-stop-tooltip-overlay-selector.md (2026-09-17 correction)

## path

- src/renderer/maestro/control/src/ChatPanel.vue
- tests/maestro/maestroChatEscape.test.mjs (new)

## verification

Record commands, results and limitations below.

### Implementation (2026-09-17)

- `ChatPanel.vue`: added `panelRef`, `stopEnabled`, `escapeStopBlockedByOverlay()`,
  `onChatEscapeKeydown()`; registered as a bubble-phase `window` keydown listener alongside the
  existing capture-phase `onPanelKeydown`. No drill-confirmation branch (bl has no `explore_session`
  feature); no cross-`WebContentsView` broadcast fallback (bl has no competing operation/browser
  view today) — both deliberate deferrals, recorded in the feature doc.
- `yarn typecheck:web` (surface `renderer/maestro`): 4 errors, identical to the pre-change baseline
  (`src/renderer/home/src/emitter/omniWindow.emitter.ts`,
  `src/renderer/home/src/views/setting/components/About/about.store.ts`,
  `src/shared/pathHelper/main/pathMain.helper.ts` ×2) — none in `ChatPanel.vue`.

### Test (pending)

`tests/maestro/maestroChatEscape.test.mjs` not yet written — needs to mirror cowork's
`chatEscape.test.mjs` harness (esbuild-bundle the real SFC + stores via `@vue/compiler-sfc`,
linkedom for DOM/focus, stub Arco + `electron-xpc/renderer`), adapted for:
- bl's local (not singleton) `shortcutStore` instance — drive the slash-menu-open case through real
  composer input rather than poking an imported store handle.
- No drill-confirmation test cases (nothing to port).
- One bl-only case: a `.chat-error-modal` blocks Escape (cowork's suite has no equivalent).
- Otherwise mirror: idle/aborting/repeat/modifier/IME/consumed-Escape, blurred/hidden views, wrong
  session, outside-target, dialog/drawer/trigger-popup/context-graph/roster ownership, tooltip content
  not blocking, opacity-fade not blocking, unmount removing the listener.

Not run yet under this task — see the shared 2026-09-17 verification note: the cowork sibling test
(`chatEscape.test.mjs`) was observed hanging/spuriously failing under extreme concurrent system load
(148+ node processes, load average 5+) on BOTH the pre-fix and post-fix source, confirming it was an
environmental issue and not a source defect — the same load conditions may affect this new bl test
when first authored and run; retry under normal load before treating a failure as real.

## delivery evidence

Pending: authoring `tests/maestro/maestroChatEscape.test.mjs`, running it clean, and human `yarn dev`
acceptance (owner step: start a turn, press Escape with focus in the composer, confirm it stops; open
a dropdown/modal/context-graph/error-modal and confirm Escape closes that first without stopping).
