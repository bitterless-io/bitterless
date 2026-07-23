# EyesOnAgents App Server Frame Overflow Review

Status: accepted

Date: 2026-07-23

## Findings

No open P1, P2, or P3 finding remains. No blocking delivery issue was found.

## Static contract assessment

- `listThreadTurns()` now requests descending `itemsView: "full"` pages with `limit: 1`, validates
  the page shape and both cursors, rejects repeated `nextCursor` values, stops after the newest
  usable textual `userMessage`, and cannot issue more than ten requests. Reverse item traversal
  preserves a later same-turn steer for the existing bounded projection.
- Every request records its own response-frame allowance. The 16 MiB allowance is assigned only to
  a Main-authored `thread/turns/list` request whose params explicitly select `itemsView: "full"`;
  matching uses the numeric response ID still present in the pending-request map. Ordinary
  responses, notifications, blank frames, unknown response IDs, and malformed oversized JSON retain
  the 4 MiB limit.
- The stdout parser consumes newline-delimited complete frames before examining the unfinished
  residual. It counts UTF-8 bytes per frame, uses `StringDecoder` so a multibyte character split
  across chunks is reconstructed once, and rejects any unfinished frame beyond the 16 MiB absolute
  cap.
- Full turn objects remain inside the Main-process recovery call. The existing service traverses
  newest turns and newest items first, projects only textual segments through the 8,192-byte bound,
  and passes only that normalized patch to SQLite. The touched supervisor adds no stdout logging,
  renderer return, broadcast, or persistence path for replies, reasoning, tools, attachments,
  earlier questions, or raw response objects.
- The regression suite directly covers a scoped 4–16 MiB full-turn response, same-sized ordinary
  response and notification rejection, ten complete frames in one chunk, split UTF-8, an unfinished
  frame above 16 MiB, one-turn pagination, same-turn steer, invalid/repeated cursors, and the ten-page
  ceiling. The UI source guard now enforces the paged request contract instead of the superseded
  ten-turn aggregate request.

## Evidence

- Contract: `docs/features/eyes-on-agents-last-user-prompt.md` lines 142–184 and
  `docs/issues/eyes-on-agents-app-server-frame-overflow.md` lines 23–35.
- Implementation: `src/main/eyesOnAgents/codexAppServer.supervisor.ts` lines 64–135, 446–483,
  631–735; bounded projection remains in `src/main/eyesOnAgents/eyesOnAgents.service.ts` lines
  264–315.
- Tests: `scripts/eyes-on-agents/app-server.test.mjs` lines 408–675 and
  `scripts/eyes-on-agents/ui-source.test.mjs` lines 334–349.

## Verification

- `yarn test:eyes-on-agents:app-server` — pass.
- `yarn test:eyes-on-agents` — pass, including core, repository, App Server, bridge, Hook delivery,
  Project filter, UI source, rendered-DOM, and activation-refresh regressions.
- `yarn typecheck:node` — pass.
- `git diff --check` — pass.
- `yarn typecheck:eyes-on-agents:core` was also inspected but remains red on two pre-existing
  `codexHookBridge.contract.ts` `rawInput` typing errors; that unchanged file is outside task 026 and
  does not affect this review conclusion.
- No Electron process was started and no package or release command was run.

## Conclusion

**Pass.** Task 026 satisfies the documented frame isolation, JSONL/UTF-8 parsing, bounded pagination,
same-turn steer, fail-closed validation, and prompt-content privacy contracts. There are no P1 or P2
findings.
