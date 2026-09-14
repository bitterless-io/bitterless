---
id: maestro-composer-history-parity-155
scope: Cowork-aligned Maestro composer footer and history interactions/shortcuts
status: done
depends-on: []
verify: focused footer/history keyboard regressions, Vue/Less compile and scoped lint
---

# Composer and history parity

## Objective and context

Implement `docs/features/maestro.md` Composer and history interaction parity, based on current
Cowork ChatPanel.vue. Apply frontend-design for existing theme fit, not a redesign. Preserve BL149
workspace full-name/no-refresh/no-greeting and task154's concurrent resize/focus changes.

## Path

Own `src/renderer/maestro/control/src/ChatPanel.vue` / `.less` and focused tests. Add only needed
locale keys, coordinated with task154. Reuse current BL history/model/workspace/turn stores, Arco
controls and IconBtn. Keep Main/DB/concurrency features out of this UI parity slice. If existing
native menu accelerators intercept history/new-chat, fix only the active Maestro Control routing
boundary; do not commandeer other windows or browser shortcuts. No destructive data operation is
part of implementing or testing this UI.

## Verification

Assert footer rows/order, workspace empty/full/clear confirmation, Stop/Send mutual exclusion and
preserved149 behavior. Exercise history open/close/current selection, keyboard wrap/Enter/no-op,
Esc/focus restoration, new-chat focus, IME/repeat/disabled guards and listener cleanup. Check native
shortcut routing conflicts by source/Node tests. Vue/Less compile and scoped lint. No full build,
heap-heavy typecheck, Electron/E2E, independent review, install/release or Git operation. Ral owns
visual, native focus and real key-command testing.

## Delivery

Implemented two footer rows (workspace/attachment, then model/voice/Stop-or-Send), full workspace
name and empty chooser text, workspace-clear confirmation, and Cowork-aligned history focus and
keyboard cursor. Cmd/Ctrl+H toggles history; arrows wrap, Enter selects, Escape closes/restores
focus; current-session selection is a no-op. Cmd/Ctrl+N starts a chat and focuses the composer.
IME/repeat guards remain. The New chat turn-lock restriction was superseded by
[browseruse-new-chat-003](browseruse-new-chat-003.md); other turn locks remain.
Native menu arbitration is limited to the focused Maestro
Control's exact H/N chords; other views and browser shortcuts are not intercepted.

Verification:31/31 focused tests including real SFC handler execution and native-service mocks;
Vue script/template and Less compilation pass. Targeted native-service semantic TS checking has
zero diagnostics. Changed source/locales/new tests pass scoped ESLint; two existing mjs files
retain six existing explicit-return-type diagnostics (all other rules pass with that rule disabled).
No ControlApp/resize change, app/E2E, full build, independent review or Git operation.

Integration with task154: the combined five-file Maestro run passes36/36. Updated the older
ChatLayout native stub with Electron's on/setIgnoreMenuShortcuts methods now used by task155;
its unchanged geometry assertions pass and the adjusted test passes scoped ESLint.

Human check: in focused Chat, test H/N and history arrows/Enter/Escape without sending text;
outside Chat, macOS Cmd+H still hides normally. Check footer layout, workspace clear confirmation
and mutually exclusive Stop/Send at380px and480px widths.

## Follow-up: right-aligned model row — 2026-09-08

Ral's screenshot shows provider/model/effort still left aligned. Align this existing group to the
right like Cowork, next to the voice and Stop/Send controls, at both380px and480px Chat widths.
Keep wrap behavior for long names, control order, disabled states and first-row workspace unchanged.
This is a narrow ChatPanel.less layout correction plus focused assertions, not a provider-logic
change (task159 owns ControlApp).

Implemented with only display:flex and justify-content:flex-end on model-controls, retaining
flex:1/min-width:0 and its existing slot. Workspace UI, history and cleanup tests pass21/21,
including the new alignment assertion. SFC/TS transform/Less compilation and scoped lint pass
(existing mjs explicit-return-type rule disabled). No new app/E2E or review was run.
