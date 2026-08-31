# Maestro / Cowork Control chat parity analysis

Date: 2026-08-31

## Decision

Use Micromeet Cowork `dev/next` commit `67b056bc08ac345d223a69fb3f954613f3e588d3`
as the stable source for the current chat behavior. Port the behavior as two serial vertical slices:

1. `maestro-cowork-chat-core-089`: turn lifecycle, steering/retry, response status, task timeline,
   confirmation queue, and the session/message persistence needed by those features.
2. `maestro-cowork-chat-files-090`: unified attachment cards, directories, thumbnails, archive tools,
   and isolated document conversion.

Do not copy Cowork's `ControlApp.vue` or renderer styles wholesale. Maestro is an established fork
with its own Local/Claude provider controls, i18n bootstrap, replay cards, fixed local Home, Arco
theme, and Less/BEM presentation. The migration is a semantic merge at every process boundary.

## Compared state

| Area | Cowork `67b056b` | Bitterless Maestro `73316b` | Migration decision |
|---|---|---|---|
| Turn lifecycle | Per-session `Turn`, lazy reply sink, inactivity watchdog, ordered timeline segments | `busy`/`aborting`/`activeTurnId`, eager assistant bubble | Port the Turn model and preserve the one-active-session policy. |
| Steering and retry | In-turn text/voice steering, explicit `mergedIntoTurn`, transient retry progress and retry affordance | Active turns disable the composer; Stop and Send alternate | Port end to end across runtime, Main, shared API, and renderer. |
| Response state | Fixed `ResponseStatus` outside message scroll | Thinking/activity spinner lives in the latest bubble | Port status, keep one Stop action, and retain Maestro wording/i18n conventions where present. |
| Tasks and confirmation | Independent task/confirm timeline entries plus one pinned actionable confirmation sheet | No task registry or confirmation message contract | Port the registry, XPC/DAO fields, renderer store, and cards. |
| Context compaction | Five-segment `ContextService` is present but Cowork's own documentation still records pending real-session validation and contract inconsistencies | Existing deferred compaction is functional and has an explicit hold contract | Preserve Maestro's current compaction algorithm; adapt the Turn integration around it. Do not backport the five-segment engine in this delivery. |
| Message presentation | White canvas, neutral AI replies without a bubble, human/error semantic bubbles, three visible activity rows, scroll-to-latest affordance | Neutral bubble for every reply, twelve activity rows, no explicit scroll affordance | Port behavior into Maestro's Less/BEM system. |
| Attachments | Shared card for composer, sent files, and artifacts; directories, thumbnails, per-entry failure text | Separate chips/cards; files only | Port the complete renderer-to-Main vertical slice. |
| File reading | Directory-aware paths, archive tools, `anydoc-wasm` UtilityProcess conversion | PDF/Office readers and workspace tools without folder/archive parity | Keep the format behavior, but replace the upstream implementation with a version-pinned, platform-staged anydoc CLI child process; keep unrelated readers until consumers are audited. |

`markdown.ts` is byte-identical and needs no migration. Cowork's Connector/WhatsApp, Demo/Capture,
fixed AI-CRMS tab/login/avatar/profile, app boot overlay, updater, browser-site scope, standalone
hardening, and Workbench-only capture paths are outside this request.

## Process boundary

```text
Control renderer
  ChatPanel / MessageList / MessageItem
      |  TurnService · TaskStore · AttachmentCard
      v
@maestro-shared coach / task / maestroChat contracts
      v
CoachXpcHandler + Maestro chat DAO
      v
MaestroAgentService / BaseAgent / task registry
      |
      +-- workspace files / thumbnail / archive
      +-- bundled anydoc CLI child process
```

Persisted identifiers such as `source: 'cowork'`, `cowork_chat_*`, and the existing profile paths
remain compatibility identifiers. Product/source symbols and XPC channels continue to use Maestro
names (`CoachXpcHandler`, `coach/*`, `MaestroChatDao`).

## Interaction and visual direction

Subject: the Maestro operator chat used to direct a browser-capable agent and inspect its live work.
Its single job is to keep the current turn, decisions, and produced evidence understandable while
the agent continues working.

Palette and type remain the Bitterless system rather than importing Cowork's Tailwind defaults:

| Role | Token |
|---|---|
| Primary action/focus | Royal Blue `#4E5882` |
| Hover | Royal Blue `#606B9D` |
| Pressed/strong label | Royal Blue `#323955` |
| Quiet background | Royal Blue 50 `#F3F5FC` |
| Border | Royal Blue 200 `#C4CADF` |
| Type | Existing renderer system/UI font stack; no new font dependency |

The signature element is a compact **turn rail** immediately above the composer: response state and
the actionable confirmation sheet stay anchored there while task cards and assistant segments keep
their chronological place in the white transcript. Attachment evidence forms a single horizontal
rail instead of vertically expanding the composer.

```text
┌──────────────────── transcript (white, scrollable) ────────────────────┐
│ human bubble                                                    right │
│ assistant text / activity segment                                left │
│ task card · progress · artifacts                                 left │
│ assistant continuation                                           left │
│                                               ↓ latest (when >80px)   │
├──────────────── pinned turn rail ──────────────────────────────────────┤
│ response / retry / task status                                         │
│ confirmation sheet (only while an answer is pending)                  │
├──────────────── composer ──────────────────────────────────────────────┤
│ attachment cards → horizontal                                         │
│ text                                             Stop  Voice  Send      │
└────────────────────────────────────────────────────────────────────────┘
```

The deliberate visual change is functional rather than decorative: assistant narration becomes
part of the canvas while human intent, failures, tasks, confirmations, and artifacts retain bounded
surfaces. No new gradients, display type, ornamental animation, or Tailwind utilities are added.

## Risk controls

- `ControlApp.vue` is merged only at the task/status/chat slots; Local/Claude provider controls and
  the removed Connector/Demo entries remain authoritative.
- `ChatPanel.vue`, message stores, shared contracts, handler, controller, DAO, and schema must land
  as complete call chains. A renderer-only port is invalid.
- The archive runtime uses the Maestro data root and packaged `maestro-tools` path. It must not
  expose passwords in process arguments. Creation with a password remains rejected.
- Directory entries never pass through byte-size/image upload gates. External-directory list/search
  results remain absolute so a subsequent `read_file` resolves the same file.
- Thumbnails are UI-only and bounded; they are never sent to the model.
- Anydoc follows the same build-time prebuilt-tool model as `rg`: pin one version, stage the official
  CLI JavaScript plus exactly one platform-native binding below `maestro-tools/anydoc`, verify the
  native asset checksum, and invoke the CLI in an Electron-as-Node child process. It is not an app
  dependency, WASM module, or UtilityProcess entry.
- Preserve the two unrelated modified OnlyPreview tests currently in the Bitterless worktree.

## Verification ownership

This request is a code migration and inspection handoff. Codex performs source inspection,
task-scoped diff checks, and independent review. Electron/Playwright/E2E, application launch,
typecheck, lint, build, and network probes are not run; Ral owns the E2E pass after the code handoff.
