---
id: eyes-on-agents-claude-hook-last-user-prompt-049
scope: provider-specific latest-user-question capture from live Claude UserPromptSubmit Hooks
status: implemented; owner verification pending
depends-on: [eyes-on-agents-last-user-prompt-016, eyes-on-agents-claude-observation-ui-038, eyes-on-agents-claude-profile-isolation-048]
---

# EyesOnAgents Claude Hook Last User Prompt

## Objective

Let Ral opt in to showing the latest user question for Claude tasks using the installed Claude
plugin's live `UserPromptSubmit` Hook. Reuse the existing compact ThreadCard presentation and
provider-qualified SQLite columns without reading Claude JSONL conversation bodies.

## Required behavior

- Add a separate default-off **Store latest user question** preference to the Claude connection
  pane. The existing Codex preference, marker, App Server recovery, and stored values remain
  independent.
- When enabled, the Claude helper may project only `UserPromptSubmit.prompt` into one bounded
  preview of at most 8,192 UTF-8 bytes. Multiline and Unicode input remain valid; NUL, invalid
  Unicode, empty/whitespace input, assistant output, tools, attachments, and every prompt field on
  non-`UserPromptSubmit` events remain outside the contract.
- Keep the raw prompt in memory only. The live socket may carry the bounded preview, but every
  outbox, quarantine, coverage marker, delivery receipt, log, error, notification, and artifact
  remains content-free. A failed live delivery is converted to the metadata-only schema before it
  is persisted.
- Keep V1 Claude Hook deliveries replayable. Add a strict V2 union in which only
  `UserPromptSubmit` may contain the preview and truncation fields.
- Main rechecks the current Claude prompt preference and admission epoch immediately before the
  SQLite transaction. Disabling fences queued/in-flight content writes, removes the Claude marker,
  waits for admitted writes, and clears only Claude prompt columns. Codex values and consent remain
  untouched.
- A live metadata-only `UserPromptSubmit` while Claude capture is enabled replaces an older Claude
  preview with `pending`; it must not leave a stale question labelled current.
- Do not recover Claude prompt text from JSONL, Desktop metadata, Agent View, the directory watcher,
  or the metadata-only outbox. An event missed while Bitterless is stopped remains pending or
  unavailable until a newer live prompt arrives.
- Renderer/XPC callers may toggle only the semantic Claude preference. They never provide prompt
  text, file paths, provider IDs, marker paths, Hook payloads, or arbitrary commands.
- The Claude connection row follows the existing flat settings-list design: concise label/copy on
  the left and a small Switch on the right; no modal, nested card, border, or extra guide.

## Expected paths

- `docs/features/eyes-on-agents-last-user-prompt.md`
- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `src/shared/eyesOnAgents/claudeHookBridge.*`
- `src/shared/eyesOnAgents/eyesOnAgents.*`
- `src/main/eyesOnAgents/claudeHookBridge.helper.ts`
- `src/main/eyesOnAgents/lastUserPromptPreference.service.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- EyesOnAgents SQLite repository/DAO
- Claude connection card, store, EN/ZH strings, and focused tests

## Verification

- Contract tests cover V1 compatibility, V2 prompt allowlisting, Unicode-safe truncation, invalid
  prompt degradation, and metadata-only offline conversion.
- A live enabled Claude `UserPromptSubmit` persists one `claude_hook` preview and renders through the
  existing ThreadCard field; a newer prompt replaces it.
- Disabled capture persists lifecycle only. Disable during an in-flight commit cannot leave Claude
  content behind and does not clear Codex content.
- Lost-ACK/offline replay contains no prompt fragment, clears stale Claude preview to pending when
  applicable, and never reads JSONL content to recover it.
- Snapshot redaction is provider-specific: each provider's disabled preference hides only its own
  values.
- Run focused contract/repository/service/UI checks, core/UI typechecks, renderer i18n, and
  `git diff --check`. Do not launch Electron; Ral owns the real Claude Hook and packaged-runtime E2E.

## Owner E2E

1. In Agent connections → Claude, enable **Store latest user question**.
2. Submit two new prompts in a Claude session that has loaded the Bitterless plugin; each latest
   bounded question should appear on its task card without manual refresh.
3. Disable the switch; every Claude question preview should disappear while Codex previews remain.
4. With Bitterless stopped, submit a Claude prompt, restart Bitterless, and confirm the old prompt is
   not reconstructed from JSONL/outbox. Submit one new live prompt and confirm it appears.

## Implementation evidence

- Claude Hook V1 remains metadata-only and replayable; V2 adds the optional prompt pair only to
  `UserPromptSubmit`, validates forbidden Unicode/NUL input, and truncates on Unicode code-point
  boundaries at 8,192 UTF-8 bytes.
- Live socket frames have a separate 64 KiB bound so every valid 8,192-byte preview still fits after
  worst-case JSON escaping. Metadata-only outbox, quarantine, and coverage files retain the stricter
  16 KiB offline bound.
- The helper reads only the sibling `claude-last-user-prompt.enabled` marker, sends the bounded V2
  preview over the live socket, and converts every failed/unarmed/outbox path back to a strict
  metadata-only delivery before disk persistence.
- Main owns an independent Claude preference epoch and in-flight commit set. Disable removes the
  marker, waits for admitted Claude commits, then clears only provider=`claude`; the existing Codex
  marker, recovery path, values, and clear operation remain provider-qualified.
- SQLite accepts `claude_hook` as the prompt source and applies prompt mutation in the same runtime
  transaction. A metadata-only Claude `UserPromptSubmit` writes a null candidate so an older preview
  becomes pending rather than remaining misleadingly visible.
- Snapshots redact by each thread's provider-specific preference. The Claude connection pane exposes
  the default-off flat settings row through a semantic XPC/store action, and ThreadCard reuses the
  existing available/pending presentation without any JSONL body read.

## Verification evidence

- `yarn test:eyes-on-agents:claude` — passed, including the new Hook prompt contract/helper/outbox
  test, an escape-heavy 8,192-byte live socket regression, and the dedicated 305-line
  `claude-hook-prompt-service.test.mjs` consent/redaction/disable-race suite. The pre-existing
  `claude-provider-toggle.test.mjs` is restored to 800 lines.
- `yarn test:eyes-on-agents:core` — passed.
- `yarn test:eyes-on-agents:repository` — passed, including provider-qualified Claude persistence
  and Claude-only clearing that preserves Codex prompt data.
- `node --test scripts/eyes-on-agents/ui-source.test.mjs` — passed, including the independent Claude
  row/store/i18n contract and provider-specific snapshot redaction source contract.
- `yarn typecheck:eyes-on-agents:core` — passed.
- `yarn typecheck:eyes-on-agents:ui` — passed.
- `yarn check:renderer-i18n` — passed.
- `git diff --check` — passed.
- The aggregate UI suite still contains a pre-existing task-045 assertion requiring the removed
  `reviewCodexBridge` action; the directly relevant UI source suite passes. Electron and packaged
  Claude E2E were intentionally not launched. Independent review accepted the non-Electron scope
  with no open P1/P2/P3 finding:
  [049 review](../reviews/eyes-on-agents-claude-hook-last-user-prompt-049-1.md). Ral's owner E2E
  remains pending.
