# Review: todo-mcp-smoke-cli-and-skill (round 1)

## Findings

- **P1 · blocking — an uncertain `todo.create` result can leave the smoke todo behind even though
  cleanup is the default contract.** The task requires the uniquely named todo to be cleaned up by
  default and requires timeout/protocol failures to fail concretely
  (`docs/plan/tasks/todo-mcp-smoke-cli-and-skill.md:26-33`). The CLI does not retain an owned cleanup
  handle until `todo.create` has returned a fully valid `{ todo: { id } }`; `todoId` remains `null`
  when the bridge commits the create but its response is delayed, dropped, or malformed
  (`scripts/mcp/todo-smoke.mjs:437-453`). The failure cleanup is skipped in exactly that case, and
  when an ID is known it calls `todo.delete` without the normal delete/status verification
  (`scripts/mcp/todo-smoke.mjs:522-535`). The deterministic fixture covers only the successful
  lifecycle, so it cannot catch either leak (`scripts/mcp/todo-smoke.test.mjs:31-47`). Minimal fix:
  add a failure-cleanup path that can reconnect and recover the uniquely titled active todo from
  the selected domain after an uncertain create, use the same delete-plus-status verification for
  known IDs, and add fixture cases for a committed create followed by timeout/malformed response
  plus a post-create assertion failure.

- **P2 · blocking — the CLI reports PASS even when the MCP helper exits non-zero during orderly
  shutdown.** The task requires helper/protocol failures to produce a non-zero CLI exit
  (`docs/plan/tasks/todo-mcp-smoke-cli-and-skill.md:32-33`), but `close()` awaits the child and
  discards its `{ code, signal }`, while the success message and return code are selected before the
  `finally` shutdown completes (`scripts/mcp/todo-smoke.mjs:344-353,611-625`). This is reproducible
  without Bitterless: running the existing fixture in `--read-only` mode makes the fixture set exit
  code 1 because its expected lifecycle is incomplete
  (`scripts/mcp/fixtures/todo-mcp.fixture.mjs:211-217`), yet the CLI prints `PASS (read-only)` and
  exits 0. Make shutdown return/validate the final child status, await termination after the forced
  kill path, and emit PASS only after a clean helper exit; cover the non-zero and non-terminating
  child cases in the fixture tests.

- **P2 · blocking — the skill tells Codex to clear `note` with `null`, but that request fails against
  the current Todo storage contract.** The task objective is for Codex to use the MCP correctly
  without rereading implementation (`docs/plan/tasks/todo-mcp-smoke-cli-and-skill.md:10-14`). The
  skill reference explicitly says `null` clears the note
  (`.agents/skills/bitterless-todo/references/tools.md:53-56`), matching the public MCP schema
  (`src/main/mcp/mcpStdio.helper.ts:119,139`) and bridge conversion
  (`src/main/mcp/mcpBridge.server.ts:394-399`). However, `todos.note` is `TEXT NOT NULL`, so the DAO
  update attempts to store SQL `NULL` and rejects (`src/preload/sqlite/dao/todo.table.ts:20`;
  `src/preload/sqlite/dao/todo.dao.ts:285-299`). Resolve this existing source-contract
  inconsistency before presenting the operation as supported: either make the MCP/storage boundary
  implement nullable-note clearing, or consistently define clearing as an empty string in schema,
  bridge, and skill.

- **P3 · non-blocking — the event reference omits the actual cursor field names needed for reliable
  resume polling.** The skill directs agents to keep a cursor and says the reference contains exact
  response shapes (`.agents/skills/bitterless-todo/SKILL.md:30,32-37`), but the reference only says
  “next cursor” (`.agents/skills/bitterless-todo/references/tools.md:72-82`). The real result is
  `{ events, latestEventId, hasMore }`, with `event.wait` adding `timedOut`
  (`src/preload/sqlite/dao/todoEvent.dao.ts:49-53,119-126`;
  `src/main/mcp/mcpBridge.server.ts:293-305`). Name those fields and state that the next
  `afterEventId` is the returned `latestEventId` so the skill is self-contained.

No additional P1 finding was found.

## Verification

| Check | Result | Evidence |
|---|---|---|
| MCP/tool contract review | blocked by Findings 1 and 3 | Tool names, lifecycle response wrappers, domain selection, status states, and successful delete verification otherwise match `mcpStdio.helper.ts`, `mcpBridge.server.ts`, and the DAO return shapes. |
| Fixture lifecycle | pass, with missing failure coverage | `yarn test:mcp:todo-smoke` exited 0 and exercised create → get → update → complete/status → uncomplete/status → delete/status entirely in the in-memory stdio fixture. No real Todo was written. |
| Help and invalid input | pass | `--help` exited 0; `--timeout 0` and an unknown option each exited 2 with usage guidance. |
| Missing helper (read-only) | pass | `--read-only --helper /tmp/...missing...` exited 1 and printed the helper-generation / `--helper` recovery instruction. |
| Timeout | pass | A safe stdio child that consumed input without replying timed out `initialize` at 100 ms, exited 1, and printed timeout recovery; the command returned in about 1.6 seconds. |
| Helper exit propagation | **blocked** | The safe `--read-only` fixture run returned CLI exit 0 even though the helper deliberately exited 1 (Finding 2). |
| Real helper / bridge | unavailable | Neither the production nor development helper existed at `~/Library/Application Support/Bitterless{,_DEBUG}/bin/bitterless-mcp`. Per review constraints, no real write was attempted and no Bitterless process was restarted or terminated. |
| macOS/Windows helper launch review | source pass; Windows runtime not available | POSIX uses direct `spawn()` and supports the generated executable shim path with spaces. The `.cmd` branch explicitly invokes `cmd.exe`; it could not be executed on this macOS host. No source-level blocking mismatch was found beyond helper-exit handling. |
| Script syntax | pass | `node --check` passed for the CLI, test, and fixture. |
| Skill mirrors and metadata | pass | Both `diff -qr` comparisons (`.agents`↔`.claude`, `.agents`↔`~/.codex`) were empty; strict YAML/frontmatter, sidecar dependency, short-description, and equivalent quick-validation checks passed in all three trees. The bundled Python `quick_validate.py` itself could not start because this environment lacks PyYAML; that dependency absence is not an implementation defect. |
| Production build | external blocker, not a finding | `yarn build` stopped while loading the existing Vite config because the current `node_modules` lacks declared dev dependency `@tailwindcss/vite`. The failure occurs before the new dependency-free scripts are loaded and is not attributed to this task. |
| Patch hygiene | pass | `git diff --check` exited 0 in both the Bitterless submodule and overmind root before this review file was added. |

## Conclusion

**blocked** — the happy-path fixture, input failures, timeout handling, missing-helper recovery,
script syntax, skill metadata, YAML, and all three mirrors pass. Delivery still needs robust cleanup
for uncertain/failed writes, propagation of helper shutdown failures, and resolution of the
documented `note: null` operation that the current database rejects. The event cursor field names
are a non-blocking documentation improvement.
