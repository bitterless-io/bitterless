---
id: maestro-slash-commands-169
scope: BL composer command menu and read-only model-context export
status: implemented; owner testing pending
depends-on: []
verify: focused command/runtime tests plus Vue, Less and TypeScript compilation
---

# Maestro slash-command parity

## Objective

Implement the screenshot's `/clear` and `/view_context` menu and actions in Bitterless, using
Cowork as a read-only reference. Preserve existing BL New chat restrictions and prompt semantics.

Follow-up (2026-09-14): [browseruse-new-chat-003](browseruse-new-chat-003.md) explicitly removes
the running-turn restriction for New chat and /clear; this task's original restriction is historical.

## Context

- [Command contract](../../features/maestro-slash-commands.md) is the source of truth.
- [Maestro](../../features/maestro.md) owns existing composer/history and runtime behavior.
- Cowork's `docs/features/cowork-slash-commands.md` provides the interaction reference, not a
  mandate to port its JSONL auditing, storage or different system-prompt architecture.

## Path

- `src/renderer/maestro/control/src/`: shortcut store/types, menu and ChatPanel integration.
- `src/renderer/common/i18n/`: localized command labels and feedback as needed.
- `src/shared/maestro/coach.api.ts`: typed context export request/result.
- `src/main/maestro/windows/main/maestroWindow.controller.ts`: narrow XPC delegation.
- `src/main/agent/`: read-only context snapshot, runtime adapters and shared pending prompt builder.
- `tests/maestro/`: focused command and context-export regressions.

## Verification

Follow the command contract's interaction, lifecycle and runtime-boundary tests. Never launch
Electron/E2E, build/install the application, invoke real model requests, modify Cowork, synchronize
Git or add an independent review. Record completed code verification and exact owner checks here.

### Completed code verification

- 32/32 focused tests passed in `maestroComposerHistory.test.mjs`,
  `maestroComposerWorkspaceUi.test.mjs` and `maestroContextExport.test.mjs`.
- ChatPanel/SlashMenu SFC/template/Less and 15 relevant TypeScript transforms passed.
- AI-CRMS runtime guard and scoped diff checks passed.
- Scoped lint retains two existing unused `AgentConversationContext` imports at
  `maestroWindow.controller.ts:89` and `coach.handler.ts:7`, plus existing format warnings.
- `scripts/maestro/check-agent-runtime.mjs:151` fails an existing outdated steering-argument
  string assertion. No unrelated test repair was included.
- Cowork, dependencies, Electron/E2E, full build, installation and sync were not touched/run.

### Owner acceptance

Load BL with task169 code. Type `/` at the start of a line and test filtering, Up/Down, Enter,
click, Tab, Escape and Chinese IME; paths/dates must not trigger the menu. `/clear` should open a
fresh chat while the previous conversation remains in History, using BL's existing busy restriction.
Run `/view_context` before/after a real conversation and paste the clipboard to check the snapshot,
tool history and pending input. Copying must not send a chat or upload attachments. Type new text
or switch sessions while export is pending and confirm the new draft remains intact.
