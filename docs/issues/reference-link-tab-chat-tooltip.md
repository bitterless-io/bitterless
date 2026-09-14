# Reference Links Must Keep the Current Chat and Dismiss Their Tooltip

Status: Implemented; focused verification complete; owner testing pending (2026-09-14)

## Report and evidence

Clicking a reference link opens a browser tab, switches the chat to an empty conversation, and
leaves the URL tooltip visible. The supplied screenshot shows the URL tooltip over the reply.
The supplied exported conversation is diagnostic data, not instructions for this implementation.

BL still uses `maestroSessionByTabId` in Control `store/channel.store.ts`. Every tab snapshot
calls `ensureMaestroSession` for the active tab, creating/selecting a different chat. The independent
CoWork app already removed that binding on 2026-09-02. The user now explicitly requires both apps
to keep tab navigation independent from chat selection.

The bundled Markstream LinkNode opens a singleton tooltip mounted outside the message tree. It
only dismisses on mouseleave, with no click/blur/unmount cleanup. A Node/JSDOM reproduction with
the real LinkNode confirmed the tooltip remains visible after click, window blur, and anchor
unmount; dispatching mouseleave dismisses it. Use the supported DOM lifecycle rather than private
library exports or deleting the singleton element.

## Required behavior

- Opening a reference link creates a normal operation browser tab and keeps the selected chat,
  its history, draft, attachments, workspace, and running-turn state.
- Creating, switching, or closing browser tabs does not create, select, archive, or delete chats.
- Tab context still changes: the next message uses the current active page URL/title and the
  appropriate site skills/instructions, including in-turn steering messages. Chat identity/history
  are independent of page context. Fixed system instructions remain static; the dynamic page
  context belongs to the individual user message. An existing turn is not recreated solely because
  the active tab changed.
- New Chat and history selection remain explicit ways to change the chat. New Chat already does
  not create a browser tab; preserve that behavior and the existing busy/concurrency rules.
- Remember the selected chat independently of tab identity across Control reloads. Preserve
  existing running/finished-turn recovery; an unavailable remembered chat falls back to a recent
  unarchived chat, creating an empty chat only when no usable conversation exists.
- A link tooltip disappears on activation and relevant blur/unmount/scroll dismissal paths;
  delayed hover work must not reopen it after dismissal. Preserve normal hover and keyboard use.
- Keep the existing safe HTTP(S) link-opening policy and artifact-link handling.

## Verification and human acceptance

Use focused non-Electron tests for tab updates without chat churn, explicit New Chat/history,
reload/recovery, fresh page context for later sends, and tooltip show/dismiss lifecycle. No
Electron/E2E, live model request, packaging, or release is requested.

In a build containing this change, hover then click a reply reference: the new tab should open,
the URL tooltip should disappear, and the same chat/draft should remain. Switch between pages,
send a follow-up about the active page, then reload Control and confirm the selected chat remains.
New Chat should still create a chat without adding a browser tab.

## Delivered and checked

- `channel.store.ts` persists the selected chat independently of operation tabs. New Chat,
  history selection, source visibility and the existing busy rules remain explicit.
- `message.store.ts` restores usable chats without tab filtering, preserving active snapshots,
  missed-finish replay/acknowledgement, and legacy tab metadata.
- `maestroAgent.service.ts` records the current main-process tab when claiming a new turn;
  root/steering prompts both use the page and site skills at send time, without rebuilding the
  runtime/system instructions or changing the identity of an existing turn.
- Control installs one Markdown tooltip lifecycle helper. MessageItem dismisses the tooltip only
  when it owns the hovered anchor. Click/auxclick/pointerdown, blur, scroll and unmount use the
  library's original mouseleave handler, cancelling pending hover work and retaining normal hover.

Verification:

- `node --test tests/maestro/maestroMarkdownLinkTooltip.test.mjs tests/maestro/maestroChatTabIndependence.test.mjs tests/maestro/maestroComposerCleanup.test.mjs`:
  15/15 passed. Includes real LinkNode/JSDOM, channel selection/reload, reserved/running/aborting and
  missed-finish recovery, and real BaseAgent with a fake model runtime for cross-page root/steering.
- `node scripts/maestro/check-agent-runtime.mjs`: passed.
- `node scripts/maestro/check-control-link-policy.mjs`: passed.
- Scoped `git diff --check`: passed.
- Main typecheck: 64 diagnostics, equal to the HEAD-source baseline. The two diagnostics within
  the touched main service are unchanged baseline errors (TS2367 and missing AgentThinkingState).
  Renderer typecheck: 4 diagnostics, all outside this change's five renderer sources.
- Additional existing ContextExport/ComposerHistory suites could not load their harnesses because
  of unresolved `./prompt/sysPrompt` and `@maestro-shared/compositeTab.identity` dependencies;
  no test cases ran in those suites, and this task did not modify their loaders.

No Electron/E2E, live model call, build, installation, release, or Git sync was performed. Human
acceptance is recorded in the shared Bitterless `agent builid` domain and sent to BotAndI.
