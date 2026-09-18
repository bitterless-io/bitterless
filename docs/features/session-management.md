# Session management: archive, title and search

**Status:** Code complete; human UI acceptance pending, 2026-09-15.
**Owner request:** Ral; apply to both BL Maestro and CoWork.

## Behavior contract

- Sessions drawer rows have a visible, borderless Archive icon button. Archive requires no confirmation, keeps content and drafts, and works for unloaded persisted sessions as well as in-memory sessions. Running/preparing sessions cannot be archived.
- A successful persisted archive removes its row, selects a usable session if the current one was archived, and updates one success Message. Rapid archives never stack multiple archive notices.
- The renderer retains exactly one business undo record: the most recently successful archive or saved title rename. A newer successful action replaces it; failures do not. Cmd/Ctrl+Z outside editable controls restores/selects an archived session or restores the renamed session's previous title and customized-title marker. Successful undo consumes only the same record; a second undo cannot restore an earlier action. Both actions update the same notice with an explicit Undo button, without stacking. The record survives notice dismissal and session switching, until undo, replacement, or renderer reload.
- Cmd/Ctrl+Z in an input, textarea or contenteditable uses Chromium's native editing undo stack. Control keeps DOM shortcut routing, but the editable handler explicitly calls a typed Main endpoint for the fixed Control WebContents' `undo()`; ignoring the menu and then returning from the DOM handler is insufficient. Do not pass arbitrary WebContents IDs, switch focus, or execute JavaScript strings. Existing native redo remains available; no business redo is added.
- Archiving the current session preserves the mounted drawer and focuses a noneditable control after fallback selection, so immediate Cmd/Ctrl+Z can restore it.
- Metadata mutation success must reflect DAO success. Saves for one session are ordered; failed metadata mutations restore local metadata and report an error. Opening/archive concurrency must not create duplicate session objects.
- The current session title replaces the top Maestro/CoWork tab label beside the panel close button (Ral's annotated screenshot). Do not add a separate title row beneath the toolbar. Double-click enters editing; Enter saves a nonempty trimmed title, Escape cancels, blur saves valid text (empty input reverts). The label and input size to their content up to the full remaining header width excluding the close button; overflow text uses an ellipsis. Persist an explicit customized-title marker so later automatic titles cannot overwrite a manual title, including one equal to the default title.
- Newly created ordinary chats start with the title `New chat` and a persisted `autoTitlePending` marker. The first actual nonblank user message supplies an immediate fallback title using the existing first-line/truncation rules and consumes that marker; the isolated background title task below may replace only that fallback. Subsequent messages never rename it, even when the first message is literally `New chat` or `Maestro`. Local slash commands, local-only/excluded messages, welcomes and attachment rows do not count. Explicit Coaches titles and existing sessions remain unchanged; a manually customized title is never automatically overwritten. Undoing a rename restores only the prior title and customized marker; it never revives consumed `autoTitlePending` state.
- Cmd/Ctrl+F opens a title-search modal in the chat control. It works while an app browser tab has focus; BL standalone OnlyPreview retains its own Find behavior.
- Search covers every non-archived session title, including unloaded history, and excludes preview/message text. Use EyesOnAgents-style NFKC/case normalization and token matching. Empty query invites typing. Existing session priority remains unchanged.
- Search results show title and existing running/unread state. Selecting a result uses the normal session-selection/mark-read path.
- Modal opens with focused input; Up/Down select, Enter opens, Escape closes. IME composition must not trigger navigation/submission. Restore composer focus on close. The drawer and search modal are mutually exclusive.
- Data failure keeps the UI usable, never claims archive/restore/rename success, and does not discard the previous undo record.
- Right-clicking a drawer row or title-search result opens a menu with Copy session path and Open in Finder (macOS) / Open in File Explorer (Windows). Both target the right-clicked session without selecting it or interrupting any turn. Main resolves its existing diagnostic-log directory by session ID; renderer never supplies an arbitrary path. Copy reports locally without entering model context or persistent history. Open opens that directory in the system file manager and surfaces missing-log/I/O/shell failures. Neither action creates an empty log directory. See the [log-path repair](../issues/maestro-model-io-chain-is-dead.md).

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

Session row → right-click
  Copy session path
  Open in Finder / File Explorer
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

## Session log context menu (2026-09-15)

Drawer rows and title-search results now open the same native menu through `sessionActions.showMenu(sessionId)`. Main resolves the right-clicked session's saved diagnostic directory for Copy session path or Open in Finder/File Explorer; menu cancellation is silent, success/error uses one local notice, and selection/history/model context are unchanged. Scope and verification are recorded in the [log-path issue](../issues/maestro-model-io-chain-is-dead.md).

## Native undo, saved rename undo and first-message titles (2026-09-15)

The previous Control key handler ignored the native menu for Cmd/Ctrl+Z, while the renderer skipped
editable targets. That combination invoked neither native text undo nor a business action. The editable
branch now prevents the default and calls typed `editControlText({ action: 'undo' })`; Main checks that
the Maestro window and its fixed Control WebContents are alive and focused, then invokes `undo()`.
Shift+Cmd/Ctrl+Z retains the existing native redo menu route. No target ID or JavaScript string crosses
this boundary, and the handler never moves focus.

Saved rename and archive share `lastUndo` in the stable action store. Both replace the same notice and
offer Undo. Rename undo restores only the target title/customized marker without switching sessions;
archive undo restores/selects the session. Failures retain the record, and successful undo consumes it
only if its identity still matches. Enter saves the title and focuses its label for immediate business
undo; blur saves without stealing focus from the next control.

All ordinary creation paths now use `New chat`, including initialization, New chat, fresh-chat fallback
and the Control action fallback. Their `autoTitlePending` marker passes through the actual serializer,
DAO detail normalization and session restoration. The first actual human text consumes it, even when a
manual title prevents automatic renaming. Immediate fallback titles retain the existing first-line, 36-character
truncation rule; legacy and explicitly named sessions do not acquire this marker.

Verification:

- `node --test tests/maestro/sessionSearchShortcuts.test.mjs` — 8/8. Tests invoke the real typed
  handler/controller/view chain and assert one native `undo()` call, focus/lifecycle rejection, other
  view isolation, and plain-Z versus Shift-Z menu routing.
- `node --test tests/maestro/maestroSessionManagement.test.mjs tests/maestro/maestroSessionsDrawerLifecycle.test.mjs`
  — 23/23. Actual compiled title/drawer components cover editable undo IPC, saved rename undo,
  focus after Enter versus blur, singleton notices, record identity and persistence failures.
- `node --test tests/maestro/maestroComposerCleanup.test.mjs tests/maestro/maestroChatTabIndependence.test.mjs`
  — 34/34. Includes actual MessageStore/TurnService sends and an in-memory SQLite DAO round-trip for
  title eligibility, literal-default first messages, later messages, manual/legacy/Coaches titles.
- Scoped Control `vue-tsc --noEmit`, scoped DAO `tsc --noEmit`, renderer i18n and `git diff --check`
  passed. Temporary typecheck configs inherited existing configs and were removed afterward.
- No app launch, Electron E2E, build or independent review. Native editing was verified at the
  WebContents API boundary; final Chromium input behavior remains a human acceptance check.

Human check: type several edits in the composer, title editor and other editable controls; Cmd+Z must
undo text and Shift+Cmd+Z redo it. Save a title with Enter, then Cmd+Z must restore the prior title.
Alternate rename/archive and verify only the latest successful business action can be undone, with
one notice. Create a chat, verify `New chat`, send a first message (also try literal `New chat`), and
verify the second message cannot rename it. Check manual titles and the same behavior after reload.

## Background first-message title (2026-09-15)

Implemented; code-verified, human testing pending. The first accepted ordinary-chat human message supplies
the immediate first-line fallback and consumes `autoTitlePending`. Its first successful save also
records one title-generation attempt (`requestId`, `firstMessageId`, expected `titleRevision`). Only
that save's success may start the request; sending continues without awaiting the generated title.
Manual/explicit Coaches titles and legacy sessions are ineligible. Reload does not retry or resume
old attempts, including unfinished ones; a crash may therefore retain the fallback. This is local
attempt deduplication, not a provider exactly-once guarantee.

`builtin:session-title` is a versioned, internal skill with original fixed instructions. It is not
added to the main chat's skill catalog. Its dedicated service creates a fresh transient session via
the existing PiRuntimeAdapter, with only the title host instructions and no tools, disk resources,
project instructions or carried history. The SDK retains its normal fixed app-agent cwd metadata.
It uses app-local auth/agent paths, Codex Luna/low, a separate
single-worker queue and a 20-second deadline covering startup and output collection. Late-created
sessions are aborted; subscriptions and sessions are cleaned up. It does not claim a main-chat slot,
broadcast activity/usage/notifications, or write the main conversation/context/agent-io logs.

Input is only the first 6000 Unicode code points of the first user text;
attachments and project files are not read. Input is data, never executable instructions. Output must
be a same-language single-line topic/action title, at most 60 code points, without tools, explanations
or sensitive identifiers. Collect at most 2000 output characters, reject malformed/empty results and
truncate a valid title locally. Do not treat SDK `maxTokens` as a provider-enforced cost guarantee.
Failure/timeout keeps the fallback silently; diagnostics may record bounded status, never text.

Apply under the existing session save queue only when the request token, first-message ID and
expected revision still match, the session exists and is unarchived, its title is not customized, and
it is not being manually edited. Every successful manual rename and rename undo increments persisted
`titleRevision`; undo never rolls the revision back. This prevents a late request from overwriting
rename → undo (the ABA case). AI naming changes only title metadata, not `updatedAt`, unread state,
selection or the business undo record. Save failure restores the fallback; an in-editor result is
discarded without adding UI.

Primary references: OpenCode separates a title agent and automatic session naming in
[its title prompt](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/agent/prompt/title.txt),
[agent definitions](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/agent/agent.ts)
and [session prompt flow](https://github.com/anomalyco/opencode/blob/e03db9bc6908f75c9334d8aa997deeaac81c0298/packages/opencode/src/session/prompt.ts).
Open WebUI exposes title generation as a separate task in
[tasks.py](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/routers/tasks.py).
These pinned sources inform task isolation and concise titles; this app's prompt is written separately.

Code verification on 2026-09-15: **66 tests passed**.

- `node --test tests/maestro/maestroComposerCleanup.test.mjs tests/maestro/maestroSessionsDrawerLifecycle.test.mjs tests/maestro/maestroSessionManagement.test.mjs` — 53/53. Actual first-send behavior proves the main request starts while initial metadata saving is pending, and completes while title generation is pending. The title request starts only after that save succeeds. Coverage includes token/revision/first-message identity, rename → undo, current editing, queued archive, removed sessions, independent targets, failed save rollback, reload deduplication and actual SQLite normalization/restore.
- `node --test tests/maestro/maestroSessionTitle.test.mjs` — 11/11. Fixed model/auth/input options, actual normalized final events, validation, separate queue, startup-plus-output deadline, late startup abort and bounded cleanup.
- `node --test --test-name-pattern='host prompt bytes|tool policy' tests/maestro/maestroRuntimeAdapterContract.test.mjs` — 2/2. Actual adapter resource loader contains no project instructions, skills or other resources; empty host/builtin tool lists map to SDK `noTools: 'all'`.
- Scoped Control `vue-tsc` and DAO/title-service `tsc` passed (temporary configs inherit project configs, set `composite: false, noEmit: true`; web includes both existing env declarations and `ControlApp.vue`, Node includes the DAO and `sessionTitle.service.ts`). Temporary configs were removed. Changed-file `git diff --check` passed.
- No model calls, app launch, Electron E2E, build or independent review. Provider title quality, language choice and removal of identifying values depend on the fixed instructions plus bounded output validation; they are not semantic guarantees. A timeout/failure or process restart retains the fallback without automatic retry.

Human check: in a new ordinary chat, send a substantive first message and confirm the first-line title appears immediately while the reply starts; after the background task succeeds, a short same-language title replaces it without a notice or selection change. While a title request is pending, manually rename (also rename then undo), open its title editor, or archive that chat; its late result must not overwrite the protected title. Confirm explicitly named/Coaches and existing sessions remain unchanged.

## 2026-09-18 Sessions drawer keyboard: Enter activates, opening selects the current session

Owner request (Ral, 2026-09-18); shared contract with CoWork
(`micromeet-cowork/docs/features/session-management.md`). In the Sessions drawer, Enter must
activate the selected row with exactly the effect of clicking it, and opening the drawer must
pre-select the session that is currently active.

- While the drawer is open it owns Up/Down/Enter/Escape. The listener is registered in the **capture**
  phase on `window` and stops propagation for those keys, so the composer never sees them. Maestro
  already did this; CoWork registered in the bubble phase, where the composer textarea handled Enter
  first (`preventDefault()` then send) and the drawer's `event.defaultPrevented` guard discarded the
  key.
- Enter routes through the same `selectHistory(id)` the row's click handler calls, so the two are
  identical by construction.
- Opening the drawer puts the cursor on the active session's row and scrolls it into view.
- The cursor is held as a **session id**, not a list index. `sessionListItems` re-sorts
  (unread → running → read) and the drawer refreshes history asynchronously while opening, so an
  index captured at open time silently points at a different session once that refresh lands — the
  cause of "opening the drawer does not select the current session". A cursor whose session leaves
  the list (archive, delete) falls back to the first row.
- Escape closes the drawer. An empty list accepts the keys and selects nothing.

Implementation: `src/renderer/maestro/control/src/SessionsDrawer.vue` only.

Verification: see the run recorded at the end of this document.
