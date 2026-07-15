# Review: todo-mcp-smoke-cli-and-skill (round 2)

## Findings

- **P1 · blocking — fresh-session cleanup is still neither race-safe nor ownership-safe, so round
  1 Finding 1 is only partially closed.** The task requires default cleanup of the uniquely owned
  smoke todo (`docs/plan/tasks/todo-mcp-smoke-cli-and-skill.md:26-33`). The repair correctly uses a
  fresh helper and verifies delete/status, but it still has three destructive uncertainty gaps:

  1. `state.todoId` is assigned before the returned domain, title, and importance are validated
     (`scripts/mcp/todo-smoke.mjs:466-484`). If any of those assertions fails, cleanup trusts that
     unvalidated ID and deletes it without first proving that the current row has the smoke title,
     selected domain, AI source, and smoke marker (`scripts/mcp/todo-smoke.mjs:587-600`). A
     protocol-corrupted create response can therefore point cleanup at an unrelated existing Todo.
  2. When the ID is unknown, recovery matches only exact title and domain and deletes **every**
     match; it does not check `source`/`note` or fail closed on ambiguity
     (`scripts/mcp/todo-smoke.mjs:572-600`). The purportedly unique ownership token is only the
     first eight UUID hex characters (`scripts/mcp/todo-smoke.mjs:457-463`), so the implementation
     must not treat multiple matches as authorization to delete all of them.
  3. Recovery lists once, accepts zero matches as success, sets `state.deleted = true`, and never
     rechecks (`scripts/mcp/todo-smoke.mjs:594-616`). That is not a completion barrier for an
     uncertain create. The CLI request may time out well before the helper's 10-second bridge
     request, and closing/killing the helper does not cancel the GUI bridge dispatch already in
     progress (`src/main/mcp/mcpStdio.helper.ts:219-236,340-365`;
     `src/main/mcp/mcpBridge.server.ts:176-188,217-219`). The write can commit after the single
     recovery list returned zero, leaving the exact orphan this fix is intended to remove.

  The new fixture cases do not reproduce these boundaries: `create-timeout` persists the Todo
  before withholding the response (`scripts/mcp/fixtures/todo-mcp.fixture.mjs:106-128`), the
  assertion fixture returns the owned Todo's real ID (`scripts/mcp/fixtures/todo-mcp.fixture.mjs:130-132`),
  and no case supplies a decoy or delayed post-list commit
  (`scripts/mcp/todo-smoke.test.mjs:99-110`). Minimal fix: distinguish a validated owned ID from an
  untrusted response ID; verify ownership before any delete; use a full client-generated ownership
  token and fail closed on ambiguous candidates; and wait/poll through a defined bridge-settlement
  window before a final zero-match assertion. Add deterministic delayed-commit, wrong-ID, and
  same-title decoy fixture cases.

No additional P1/P2 finding was found.

## Round 1 finding closure

| Round 1 finding | Result | Evidence |
|---|---|---|
| P1 uncertain-create / failure cleanup | **partial / blocked** | Fresh-session recovery and `deleteAndVerify()` now cover the fixture's already-committed unknown-ID case and known owned IDs, but the race and ownership gaps above remain. |
| P2 helper non-zero shutdown | closed | PASS is emitted only after `close()` and `assertCleanExit()`; non-zero exit 7 produces CLI exit 1 with no PASS (`scripts/mcp/todo-smoke.mjs:351-374,549-563,706-726`; `scripts/mcp/todo-smoke.test.mjs:112-115`). |
| P2 `note: null` contract | closed | Create/update schemas are string-only, the bridge rejects non-strings, and all three skill copies specify `""` for clearing and prohibit `note: null` (`src/main/mcp/mcpStdio.helper.ts:119-123,143-147`; `src/main/mcp/mcpBridge.server.ts:394-399`; `.agents/skills/bitterless-todo/references/tools.md:53-57`). |
| P3 event cursor fields | closed | The reference now names `{ events, latestEventId, hasMore }`, adds `timedOut` for wait, and explicitly feeds `latestEventId` into the next `afterEventId` (`.agents/skills/bitterless-todo/references/tools.md:73-86`). |

## Verification

| Check | Result | Evidence |
|---|---|---|
| Expanded deterministic fixture suite | pass within its modeled cases | `yarn test:mcp:todo-smoke` exited 0 in 11.9 seconds. It covered happy lifecycle, already-committed create timeout, malformed create response, post-create assertion cleanup, helper exit 7, and EOF-resistant forced termination. No real Todo was written. |
| Known-ID cleanup mechanics | pass after ownership is established | Cleanup calls the shared delete confirmation plus `todo.status === deleted`; fixture assertions prove delete/status occur in the fresh session. The remaining blocker is deciding whether the ID is owned before invoking that destructive path. |
| Helper non-zero / forced termination | pass | Both cases exit 1, suppress PASS, and finish within the fixture bound. `close()` awaits the SIGTERM/SIGKILL result and treats every forced shutdown as failure. |
| Help, invalid input, missing helper | pass | Help exited 0; invalid timeout exited 2; a missing helper in `--read-only` mode exited 1 with concrete recovery guidance. |
| Note and event contracts | pass | Source inspection and cross-tree search found string-only note clearing and the exact event cursor fields consistently documented. |
| Script syntax | pass | `node --check` passed for the CLI, fixture, and test. The orchestrator separately reports `typecheck:node` passing; the existing whole-file ESLint `createToolText(..., result)` unused-parameter error predates this repair and is not attributed to it. |
| Skill mirrors / YAML | pass | `.agents`↔`.claude` and `.agents`↔`~/.codex` `diff -qr` checks were empty; strict YAML and MCP sidecar checks passed. |
| Real helper / bridge | unavailable | Both standard production and development helper paths remain absent. Per review constraints, no real write was attempted and no Bitterless process was restarted or terminated. |
| Production build | external blocker, not a finding | `yarn build` again stopped before loading task code because current `node_modules` lacks declared `@tailwindcss/vite`. This is unchanged and is not attributed to the implementation. |
| Patch hygiene | pass | `git diff --check` exited 0 in the Bitterless submodule and overmind root before this review file was added. |

## Conclusion

**blocked** — helper shutdown semantics, note string-only behavior, event cursor documentation, and
the modeled cleanup cases now pass. The smoke CLI is not yet safe to deliver because an uncertain
create can still commit after a zero-match recovery, while an untrusted ID or ambiguous title match
can authorize deletion of a Todo that the smoke run has not proved it owns.
