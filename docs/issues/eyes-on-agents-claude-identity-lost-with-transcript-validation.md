# A new Claude session never appears, because its iTerm2 identity is discarded with a failed transcript check

Status: Closed by iTerm2 integration removal in
[task 097](../plan/tasks/eyes-on-agents-remove-iterm2-claude-097.md)

The terminal-only visibility route described below no longer exists. Claude cards now require a
trusted Desktop mapping; old terminal fields remain readable only for upgrade compatibility and
cannot make a row visible. The remaining text is retained as history rather than an active repair
contract.

Reported: 2026-09-04, by the owner, from the packaged Preview build ("新的会话没在 eyesonagent 出现")

## Symptom

A freshly started `claude2` session never appears in Focus. The hook fires and its delivery is
consumed (the outbox is empty with an mtime matching the session's last transcript write), the
plugin is installed for that environment, and the environment's watcher reports `Watching` — yet no
row is ever visible. Earlier sessions sometimes do appear, which made this look intermittent.

## Root cause

`EyesOnAgentsService.commitClaudeHookDelivery` persists a session's **terminal identity** only
inside the transcript-validation branch (`src/main/eyesOnAgents/eyesOnAgents.service.ts:3339-3362`):

```ts
if (payload.transcriptPath && this.dependencies.validateClaudeTranscript) {
  try {
    const transcriptPath = this.dependencies.validateClaudeTranscript(
      payload.transcriptPath, payload.sessionId
    );
    await this.dependencies.repository.upsertClaudeInventory({
      threads: [{ threadId: payload.sessionId, desktopSessionId: null,
        iterm2SessionId,            // ← the only place this is ever written
        claudeConfigDir,            // ← and this
        transcriptPath, … }]
    });
  } catch {
    // A path mismatch cannot reject otherwise valid content-free lifecycle evidence.
  }
}
```

`iterm2SessionId` and `claudeConfigDir` have **nothing to do with the transcript** — they come from
the hook's own environment (`ITERM_SESSION_ID`, `CLAUDE_CONFIG_DIR`). But they are written only by
this one call, so any failure of the transcript check silently drops them. The `catch` comment
justifies preserving the *lifecycle* evidence and is right about that; it does not mention that it
also throws away the *identity*, which is a different thing.

### Why the check fails for a new session

`requireCanonicalTranscript` (`claudeObservation.service.ts:226-240`) delegates to
`requireCanonicalClaudeTranscript`, which does `lstatSync(params.transcriptPath)`
(`claudePath.resolver.ts:139`) before anything else. At **SessionStart** — the only event that ever
carries terminal identity — Claude Code has not necessarily created the JSONL yet, so `lstatSync`
throws `ENOENT`. It also throws `'Claude projects root is unavailable'` when no environment has a
resolved `projectsRoot` yet, which is exactly the state during app start or right after adding an
environment.

### Why it is permanent, not transient

Terminal identity is captured **only on SessionStart** (schema V3/V4); every later event
(`UserPromptSubmit`, `Stop`, …) is V2 and carries none
(`eyesOnAgents.service.ts:3316-3329` derives `iterm2SessionId` only from a V3/V4 payload). So there
is exactly one chance to persist it. If that one delivery's upsert is skipped, nothing later can
recover it — and the visibility gate
(`eyesOnAgents.service.ts:854-858`, `desktopSessionId !== null || iterm2SessionId !== null`) hides
the row **forever**, even though the thread exists in the database with correct lifecycle state.

That also explains the apparent intermittency: whether a session becomes visible depends on whether
its JSONL happened to exist at the instant SessionStart was committed.

## Why no test caught it

The hook tests supply a transcript path that exists in their fixture, so validation succeeds and the
identity lands. No test exercises SessionStart with a not-yet-created transcript, and the `catch` is
silent, so nothing observable distinguishes "identity persisted" from "identity dropped".

## Repair

- **Decouple identity from the transcript.** Persist `iterm2SessionId` / `claudeConfigDir` whenever a
  delivery carries them, independent of transcript validation. `upsertClaudeInventory` already
  preserves on null (`thread.iterm2SessionId ?? row.iterm2_session_id`), so a later event that
  carries no identity cannot clear it.
- Keep the transcript path itself gated on validation — that check is doing real work and must not be
  loosened.
- **Stop swallowing the failure.** Log it (the `[claude-hook]` helper added in task 095 is the right
  place), so a dropped transcript path is visible instead of silent.
- Regression tests: a SessionStart whose transcript does not exist must still persist the identity
  and become visible; a SessionStart with a valid transcript must persist both; and a later
  identity-free event must not clear a stored identity.

## Related

- The visibility gate this exposes is from `eyes-on-agents-iterm2-backend-082`; identity capture is
  `...-hook-capture-081`; environment attribution is `...-hook-attribution-087`.
- Task 095 added the `[claude-hook]` and `[claude-visibility]` logging that would have made this
  diagnosable in minutes rather than by source reading. It is not yet in a packaged build.
