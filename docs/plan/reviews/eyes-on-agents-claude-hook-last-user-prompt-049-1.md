# EyesOnAgents Claude Hook Last User Prompt — Independent Acceptance

Status: accepted for non-Electron scope; owner packaged Claude E2E pending

Date: 2026-08-18

## Verdict

**Implementation: PASS.** No open P1 or P2 finding blocks Ral's packaged test. Claude now has a
separate default-off consent marker, admits one bounded question only from a live
`UserPromptSubmit`, persists it provider-qualified as `claude_hook`, and keeps every offline Hook
artifact metadata-only. Disabling fences admitted Claude writes and clears only Claude prompt
columns; Codex consent, recovery, and stored values remain independent.

The task stays `in-progress` until Ral completes the real packaged Claude flow.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

### Resolved during review

- **P2 · live frame rejected some valid 8,192-byte prompts.** The first implementation reused the
  16 KiB offline file bound for live socket frames. JSON escaping made a valid escape-heavy prompt
  exceed that frame, so it degraded to metadata-only instead of reaching Main. The refreeze splits
  the limits: live delivery/server input use 64 KiB, while outbox, quarantine, coverage, emergency,
  and ACK bounds stay at 16 KiB. A real local-socket regression now carries an escape-heavy
  8,192-byte preview end to end and proves the durable fallback contains no prompt field.

## Privacy and lifecycle matrix

| Case | Verified behavior | Result |
|---|---|---|
| Default and provider isolation | Claude uses `<userData>/eyes-on-agents/claude-last-user-prompt.enabled`; Codex retains its existing marker and both start Off independently | PASS |
| Hook allowlist | Only V2 `UserPromptSubmit` may carry the prompt pair; V1 remains metadata-only/replayable and other events reject prompt fields | PASS |
| Content bound | Input is trimmed, empty/NUL/unpaired-surrogate values degrade to metadata-only, and Unicode truncation preserves code-point boundaries at 8,192 UTF-8 bytes | PASS |
| Live framing | 64 KiB live input covers worst-case JSON escaping for the bounded preview; the server applies the same bound | PASS |
| Lost ACK/offline | Helper fallback and server-side unarmed persistence both call the metadata-only conversion before disk; replay rejects content-bearing files | PASS |
| Durable artifacts | Pending delivery, quarantine marker, coverage marker, emergency marker, receipt, logs, and completion notifications contain no prompt text | PASS |
| Main admission | Main rechecks the independent Claude preference epoch immediately before repository persistence | PASS |
| Disable race | Disable advances the epoch, removes the marker, waits for admitted Claude commits, then clears only provider=`claude` | PASS |
| Metadata-only newest prompt | An enabled metadata-only `UserPromptSubmit` supplies a null candidate, replacing an older visible preview with `pending` | PASS |
| SQLite qualification | `claude_hook` is accepted only through Hook turn-start persistence; prompt update and receipt share the runtime transaction and provider-qualified row | PASS |
| Snapshot redaction | Claude and Codex prompt projections are each redacted by their own preference | PASS |
| Renderer/XPC boundary | The Claude row calls one boolean semantic action; renderer callers provide no prompt, provider, path, marker, Hook payload, or command | PASS |
| JSONL exclusion | Claude transcript inventory uses directory enumeration, `lstat`, and `realpath` only; no transcript body is opened or parsed for prompt recovery | PASS |
| UI contract | One flat label/copy-left and small-Switch-right row reuses the existing settings list and ThreadCard projection | PASS |

## Static evidence

- `claudeHookBridge.contract.ts` defines the strict V1/V2 union, prompt-field pairing, event
  allowlist, Unicode validation, code-point-safe 8,192-byte truncation, and metadata-only
  conversion.
- `claudeHookBridge.helper.ts` derives only the sibling Claude marker, checks it on every invocation,
  sends the bounded live event, and passes only a stripped delivery to durable fallback.
- `claudeHookOutbox.service.ts` applies the 64 KiB limit only to outgoing live delivery, retains the
  16 KiB offline/ACK limits, sanitizes direct persistence, and parses replay as metadata-only.
- `claudeHookBridge.server.ts` bounds live input at 64 KiB and routes every unarmed delivery through
  the sanitizing outbox writer.
- `eyesOnAgents.service.ts` owns a Claude-specific preference epoch and active-operation set,
  provider-specific snapshot redaction, metadata-only-to-pending behavior, and Claude-only disable
  cleanup.
- `eyesOnAgents.dao.ts` validates `claude_hook`, derives provider from runtime source, updates prompt
  state in the same transaction as lifecycle/receipt persistence, and requires an explicit provider
  list for cleanup.
- `eyesOnAgents.handler.ts`, the renderer store, and `ClaudeObservationCard.vue` expose only the
  semantic boolean toggle and the compact flat settings row.
- `claudeTranscriptInventory.adapter.ts` remains body-blind: it enumerates and stats exact UUID
  `.jsonl` paths without reading their contents.
- `claude-hook-prompt-service.test.mjs` isolates consent, redaction, disabled-capture lifecycle, and
  disable-race coverage in 305 lines. The pre-existing provider-toggle fixture remains byte-for-byte
  unchanged at its 800-line baseline.

## Independent verification

| Check | Result |
|---|---|
| `node --test scripts/eyes-on-agents/claude-hook-prompt.test.mjs scripts/eyes-on-agents/claude-hook-prompt-service.test.mjs` | PASS — 7/7 |
| `yarn test:eyes-on-agents:claude` | PASS — every stage passed; Hook prompt/service 7/7, Hook admission 6/6, combined provider suite 23/23 |
| `yarn test:eyes-on-agents:core` | PASS |
| `yarn test:eyes-on-agents:repository` | PASS |
| `node --test scripts/eyes-on-agents/ui-source.test.mjs` | PASS — 25/25 |
| `yarn typecheck:eyes-on-agents:core` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn check:renderer-i18n` | PASS |
| `git diff --check` | PASS |

No Electron process, browser E2E, or packaging command was run. This review changes only this
acceptance file and intentionally leaves task 049 `in-progress` for Ral's real Claude verification.

## Owner acceptance remaining

In the packaged build, enable **Store latest user question** under Claude, submit two prompts in a
session with the refreshed Bitterless plugin, confirm each newest question appears, then disable the
switch and confirm Claude previews disappear while Codex previews remain. Finally submit once while
Bitterless is stopped, restart, confirm that question is not reconstructed, and submit one new live
prompt to confirm capture resumes.

## Conclusion

**Accepted for the verified scope.** The implementation is Hook-only, provider-isolated, bounded,
and offline-content-free. Ral's packaged Claude E2E is the remaining completion gate.
