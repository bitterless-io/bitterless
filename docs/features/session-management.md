# Session management: archive, title and search

**Status:** Code complete; human UI acceptance pending, 2026-09-14.
**Owner request:** Ral; apply to both BL Maestro and CoWork.

## Behavior contract

- Sessions drawer rows have a visible, borderless Archive icon button. Archive requires no confirmation, keeps content and drafts, and works for unloaded persisted sessions as well as in-memory sessions. Running/preparing sessions cannot be archived.
- A successful persisted archive removes its row, selects a usable session if the current one was archived, and updates one success Message. Rapid archives never stack multiple archive notices.
- The renderer retains exactly one undo record: the most recently successful archive. A newer successful archive replaces it; failures do not. Cmd/Ctrl+Z outside editable controls restores and selects this session, then clears the record. A second undo cannot restore an earlier archive. The notice offers an explicit Undo action so text editing remains available. The record survives notice dismissal and session switching, until undo, replacement, or renderer reload. This is transient undo, not a persistent archive browser.
- Archiving the current session preserves the mounted drawer and focuses a noneditable control after fallback selection, so immediate Cmd/Ctrl+Z can restore it.
- Metadata mutation success must reflect DAO success. Saves for one session are ordered; failed metadata mutations restore local metadata and report an error. Opening/archive concurrency must not create duplicate session objects.
- The current session title replaces the top Maestro/CoWork tab label beside the panel close button (Ral's annotated screenshot). Do not add a separate title row beneath the toolbar. Double-click enters editing; Enter saves a nonempty trimmed title, Escape cancels, blur saves valid text (empty input reverts). The label and input size to their content up to the full remaining header width excluding the close button; overflow text uses an ellipsis. Persist an explicit customized-title marker so later automatic titles cannot overwrite a manual title, including one equal to the default title.
- Cmd/Ctrl+F opens a title-search modal in the chat control. It works while an app browser tab has focus; BL standalone OnlyPreview retains its own Find behavior.
- Search covers every non-archived session title, including unloaded history, and excludes preview/message text. Use EyesOnAgents-style NFKC/case normalization and token matching. Empty query invites typing. Existing session priority remains unchanged.
- Search results show title and existing running/unread state. Selecting a result uses the normal session-selection/mark-read path.
- Modal opens with focused input; Up/Down select, Enter opens, Escape closes. IME composition must not trigger navigation/submission. Restore composer focus on close. The drawer and search modal are mutually exclusive.
- Data failure keeps the UI usable, never claims archive/restore/rename success, and does not discard the previous undo record.

## Presentation

2026-09-14 regression fixes: the current session is indicated by a thick highlighted left border, replacing the arrow (explicit owner exception to the borderless default). Keep the Sessions drawer mounted while the active chat changes so archiving the current row never closes/reopens the drawer. New chat must remain available while another session is running, and separate sessions can send concurrently up to the existing CoWork limit of four; only the actual capacity limit or same-session work may reject a send.

2026-09-14 layout adjustment: place the search icon directly after the Sessions drawer heading with an 8 px gap; the close control stays at the far right. Do not distribute the search icon into the center of the header.

Use existing app typography, accent and warm chat surface. No new borders or divider lines. Title row is compact; archive is a separate icon control beside each selectable row (no nested buttons). Search uses the EyesOnAgents modal width (up to 560 px), rounded background, and independently scrolling results.

```text
Current session title… (double-click)    Close
Sessions                         New chat
Messages…

Sessions drawer              Title search modal
Title / preview   status [archive]   Search titles…
Title / preview   status [archive]   Title   running / unread
                                    Title   running / unread
Single message: Archived “title” · Undo (⌘Z)
```

## Code verification and human acceptance

Code verification should cover archive of unloaded/empty sessions, persistence errors and ordering, single undo replacement/consumption, customized title round-trip, title-only matching and status data, shortcut routing and Vue compilation. No Electron E2E or live app launch.

Human acceptance: archive two sessions quickly and see one message; undo restores only the last session; edit title, switch away/back and reload; search a title with Cmd+F from both chat and browser focus, select running/unread results; verify input Cmd+Z and standalone preview Find retain their normal behavior.

## Implementation and verification

- Header: `src/renderer/maestro/control/src/ControlApp.vue` + `SessionTitle.vue/.less`; the hidden measurement text alone sizes the editor, and the overlaid input cannot impose its native default width.
- Search/actions: `SessionSearchModal.vue/.less`, `store/sessionActions.store.ts`, `ChatPanel.vue`. The action store owns drawer/search visibility and the single undo record across keyed session panels.
- Persistence: `store/message.store.ts`, `store/turn.service.ts`, `store/message.type.ts`, shared `coach.api.ts`, and `preload/maestro/sqlite/maestroChat.dao.ts`.
- Main routing: Maestro shortcut helper, Control view service, `maestroWindow.handler.ts`, application Find menu and embedded OnlyPreview handlers; Home layout opens a collapsed panel.
- Passed: `node --test tests/maestro/maestroSessionManagement.test.mjs tests/maestro/maestroComposerCleanup.test.mjs` — 23 tests. `node --test tests/maestro/sessionSearchShortcuts.test.mjs tests/onlypreview/onlyPreviewApplicationFindMenu.test.mjs` — 12 tests.
- Passed: scoped Control Vue typecheck, scoped DAO typecheck, renderer i18n, Vue/Less component compilation, and changed-file whitespace checks.
- Whole Node typecheck exhausted its default 4 GB heap; the narrowed main check completed with 32 diagnostics in existing dependencies/unmodified statements (including pre-existing OnlyPreview spread-call errors). No new shortcut-routing diagnostics. Full repository typecheck is therefore not clean. No Electron E2E or live app launch was performed.

## Related

- BL: `docs/features/maestro-session-list-unread.md`
- CoWork: `docs/features/cowork-multi-session.md`

## Current-session and parallel-chat regression verification

The drawer now lives in an unkeyed `SessionsDrawer.vue` sibling in `ControlApp.vue`, outside the keyed chat/composer. The current row uses a 4 px highlighted left border, with no arrow. Component lifecycle checks mount the actual Vue components and confirm that archiving current rows preserves the drawer instance, host/list nodes and scroll state while the composer remounts.

New chat releases its creation guard after selecting the new session; asynchronous empty-draft cleanup cannot block another New chat. BL now admits four sessions in both renderer and main process. Main recovery carries every active turn; finishing, cancelling or recovering one turn does not erase another session. Outputs, confirmations and task status are attributed to their owning session. CoWork's preparation phase counts toward its existing four slots; another session's drill no longer blocks an ordinary chat, while the shared drill recording resource remains exclusive.

Verified on 2026-09-14: BL drawer/actions/composer UI tests 23, renderer concurrency/recovery/persistence tests 20, chat/tab/new-chat tests 9, main concurrency tests 10, drill invariants 14, browser-session isolation tests 19. CoWork drawer lifecycle/keyboard/compile checks 4 and new-chat/preparation tests 10 passed. BL scoped Control types and i18n passed; scoped main diagnostics stayed identical to the prior 32-error baseline. CoWork web typecheck retains its two existing OnlyPreview diagnostics. No Electron E2E or live application was started.

Human check: after loading the updated application code, open Sessions and archive the current/first, middle and last rows; the drawer must stay visible with unchanged scroll. Quickly send in A, create and send in B, then stop A: B must continue. Repeat up to four sessions; only a fifth send waits. Confirm the left marker follows selection and Cmd+Z still restores only the latest archive.
