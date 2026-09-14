---
id: browseruse-new-chat-003
scope: new chat during running browser or chat turns
status: done
depends-on: [browseruse-lifecycle-002]
---

# New chat remains available during running work

## Objective

Ral reported the refusal “New chat is unavailable while a turn is running or this chat is inactive.” while an agent was operating a page. Both BL and CoWork must let the user create and switch to a fresh normal chat while the existing task continues, just as history switching already does. This supersedes any older New chat turn-lock restriction. Implementation is authorized on the existing branch.

## Context and contract

- [Browser-use lifecycle](browseruse-lifecycle-002.md) and [browser session target contract](../../issues/agent-browser-session-tabs.md).
- The New chat button, Cmd/Ctrl+N and the existing /clear alias use one creation path. Running/streaming/awaiting a tool is not a reason to refuse New chat. Do not broadly unlock message sending or other turn-locked controls.
- Create a distinct session and select/focus its empty composer. Keep normal workspace/model inheritance and existing persistence rules.
- Preserve the old task's runtime, transcript, queued input and pending tool results. Do not call global reset, abort, drop a running “empty” session, or release its browser targets/use markers/recording. Streaming and completion route to their original session; history can return to it.
- Only remove an old unused draft when it is actually empty and idle. A running empty session must remain in the history/runtime until its work completes.
- Optional old-empty-draft cleanup must not undo a successfully created/selected chat. If cleanup fails, keep the old draft and report/log the cleanup failure using the existing channel; do not reset or clear either task. If cleanup is asynchronous, it must not delete a draft that became active work in the meantime.
- Where the existing persistence delete is unconditional, empty-draft cleanup must use a conditional delete that refuses a session with persisted messages, checked atomically at deletion. Preserve normal explicit-delete behavior. Do not remove the renderer session before successful eligible cleanup, and recheck its active/running/content state before removing it afterwards.
- Keep a creation-in-progress guard to prevent overlapping button/keyboard/alias actions from creating duplicate chats. Reject stale source-session requests so a delayed callback cannot hijack a newly selected session.
- Failed/refused creation preserves the current draft and attachments and leaves the visible session intact. Late completion must not clear a different/newly edited draft. Preserve unrelated connector/archive policies unless their current implementation contradicts the running-chat requirement.
- Do not use the browser foreground tab or browser ownership to decide whether New chat is available. New chat changes the conversation shown, not the current website or another task's browser state.
- No layout redesign: keep the existing toolbar and borderless control.

## Interaction

```text
Task A running on tab A  [History] [New chat]
                             New chat / Cmd+N / /clear
Task B empty composer   [History] [New chat]
Task A continues in history with its original browser target and use marker.
```

## Path

ChatPanel entry points, ControlApp keyboard entry, channel/message session stores, creation/persistence IPC only where necessary, stale i18n refusal text, focused behavior tests and existing shortcut/session guards.

## Verification

1. Start a running turn in A; all supported New chat entry points create/select a distinct B without abort/reset/cleanup of A. History can switch back and receive A's result.
2. A remains protected from draft deletion even if its initial transcript is not populated; browser use/target state is unchanged by creation.
3. Concurrent New chat triggers create once; stale-source requests and failed creation do not clear drafts/attachments or steal selection.
4. Relevant existing shortcut/session tests and Vue/type diagnostics; no Electron E2E or installed-app launch. Finish code verification and hand off the exact human check.

## Delivery

Implemented and code-verified; human testing pending.

Removed the New-chat-specific turn guard in ChatPanel and channel creation while preserving other turn-locked controls. Button, Cmd/Ctrl+N and /clear use one path. Creation selects synchronously before optional cleanup; running old sessions are retained. Conditional DAO deletion checks messages in a transaction, and renderer cleanup only removes a still-empty/idle/unselected session after successful persistence. Failures preserve drafts/attachments and existing sessions; no runtime abort/reset or browser-state release is called.

Verification: 56/56 targeted tests passed, including New chat entry points, running empty/populated sessions, late selection, duplicate/failure behavior, draft reuse races, actual in-memory SQLite conditional deletion/rollback and 18 browser-use lifecycle cases. Existing composer-history test fixtures were adapted to current session-list/workspace/shortcut interfaces without changing those product behaviors. i18n and scoped diff checks passed.

Type diagnostics: main 64→64, Maestro renderer 49→49 and scoped preload/maestro 7→7; no added or removed normalized diagnostics. The main baseline is the immediately preceding lifecycle run. Preload baseline reads the pre-task DAO/API versions from Git HEAD virtually with current unchanged dependencies. A combined main+all-preload attempt ran out of memory in the existing LangGraph dependency scope and did not complete; the relevant scopes were checked separately. This is not a claim that whole-project typechecking passes.

Evidence: overmind tmp/browseruse-review/bl-new-chat-targeted.txt, bl-new-chat-typecheck-comparison.json, bl-new-chat-i18n.txt and the corresponding before/after logs.

No Electron/E2E, installed-app launch, real-user database mutation, build/release, branch switch or sync. Human test the three creation entry points while A works a page, confirm a fresh B is selected and A continues, return through History to see its result, and exercise rapid repeated creation/failure without losing drafts or browser/drill state.
