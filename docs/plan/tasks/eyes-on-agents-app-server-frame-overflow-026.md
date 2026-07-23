---
id: eyes-on-agents-app-server-frame-overflow-026
scope: keep opted-in latest-question recovery within bounded Codex App Server frames
status: implemented; owner verification pending
depends-on: [eyes-on-agents-last-user-prompt-016, eyes-on-agents-tiered-all-polling-019]
---

# EyesOnAgents App Server Frame Overflow

## Objective

Prevent a legitimate large latest-question recovery response from repeatedly terminating the
managed Codex App Server connection, while retaining the 4 MiB ordinary-frame guard, the 8 KiB
persisted preview, same-turn steer recovery, and content-free logs/storage outside the consented
preview.

## Context

- `docs/issues/eyes-on-agents-app-server-frame-overflow.md`
- `docs/features/eyes-on-agents-last-user-prompt.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/INDEX.md`

## Path

- `src/main/eyesOnAgents/codexAppServer.supervisor.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `scripts/eyes-on-agents/app-server.test.mjs`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- the Context documents above

## Required behavior

- `thread/turns/list(itemsView: full)` uses descending one-turn pages and follows no more than ten
  turns, stopping at the first newest textual `userMessage`.
- The supervisor validates every page, cursor, full-items marker, and maximum traversal count.
- Ordinary App Server responses and notifications remain capped at 4 MiB. Only a pending,
  Bitterless-authored full-turn request can accept a complete frame up to 16 MiB; an unfinished
  frame is never allowed beyond that absolute cap.
- The stdout parser consumes complete JSONL frames before checking the unfinished residual buffer.
  Per-frame byte checks use UTF-8 bytes and remain correct when multibyte characters cross chunks.
- Content projection remains bounded to the newest 8 KiB textual prompt. No response, reasoning,
  tool result, attachment, or earlier question is logged, persisted, broadcast, or returned.
- Prompt recovery failure does not fabricate prompt state. Existing metadata, terminal-turn,
  polling, Refresh, and connection-intent behavior remains unchanged.

## Verification

- A valid full-turn response between 4 MiB and 16 MiB is accepted only for the scoped content
  request; the same-sized ordinary response or notification fails closed.
- Ten small frames delivered together do not trip the single-frame guard.
- Split multibyte UTF-8 remains valid JSON.
- Prompt recovery requests `limit: 1`, follows validated cursors only as needed, stops on the newest
  textual user message, and never scans more than ten turns.
- Existing App Server, core, repository, bridge, and UI-source regressions pass.
- `yarn typecheck:node` and `git diff --check` pass.
- Do not start Electron and do not package or release; Ral owns runtime verification.

## Delivery evidence

- Read-only probes against the selected ChatGPT-bundled Codex App Server confirmed ordinary
  inventory frames below 110 KiB and valid ten-turn full responses between approximately 6.8 MiB
  and 8.9 MiB. Paging the affected threads one turn at a time reduced the observed maximum frames
  to values covered by the scoped 16 MiB allowance.
- App Server regressions cover one-turn pagination, same-turn steer preservation, invalid and
  repeated cursors, the ten-turn ceiling, scoped 4–16 MiB responses, unchanged ordinary-response
  and notification limits, multiple frames in one chunk, split UTF-8, and the 16 MiB absolute cap.
- `yarn test:eyes-on-agents`, `yarn typecheck:node`, and `git diff --check` pass.
- [Independent review](../reviews/eyes-on-agents-app-server-frame-overflow-026-1.md) accepted the
  implementation with no P1, P2, or P3 finding.
- Electron was not started and no package or release was produced; Ral owns runtime verification.
