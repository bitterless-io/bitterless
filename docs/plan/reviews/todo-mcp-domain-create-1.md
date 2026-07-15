# Review: todo-mcp-domain-create (round 1)

## Findings

- **P2 · blocking — concurrent MCP creates can bypass the 17-active-domain limit.** The task
  requires rejection once 17 active domains exist
  (`docs/plan/tasks/todo-mcp-domain-create.md:22-25`). In the round-1 implementation,
  `createDomain()` performed `DomainDao.getAll()` and `DomainDao.create()` as separate asynchronous
  operations with no serialization (`src/main/mcp/mcpBridge.server.ts:291-296` in the reviewed
  snapshot), while both the stdio helper and bridge dispatch requests concurrently. A temporary
  in-memory bridge fixture starting with 16 active domains sent two simultaneous `domain.create`
  requests; both returned success and the final active count was 18. The checked-in contract test
  covered only a sequential create followed by a limit rejection
  (`scripts/mcp/domain-create.test.mjs:188-207` in the reviewed snapshot), so it passed without
  detecting the race. Serialize the check-and-create sequence (and recover the queue after a
  rejected request), then add a deterministic public-MCP concurrency case proving exactly one of
  two creates succeeds at 16 active domains and the final active count remains 17.

No additional P1/P2 finding was found.

## Round 1 finding resolution

**Closed.** `McpBridgeServer` now chains every domain create through `domainCreateQueue`, and the
queue's success and rejection handlers both settle back to `Promise<void>` before the next request
runs (`src/main/mcp/mcpBridge.server.ts:97-100,269-311`). The active-count read and DAO create are
therefore one serialized MCP critical section. A limit rejection cannot poison the queue.

The public stdio fixture now captures a domain snapshot at each `getAll()` call and uses a bounded
race probe (`scripts/mcp/domain-create.test.mjs:18-48`). At 16 active domains, two concurrent public
tool calls produce one success and one limit rejection; only one `getAll()` enters the probe before
the first create finishes, the final active count is 17, and a subsequent create succeeds after an
active domain is archived (`scripts/mcp/domain-create.test.mjs:227-262`). This gate has regression
power: without the queue, both calls enter the probe, capture the same 16-domain snapshot, and both
create.

## In-review contract correction

The first skill snapshot required `domain.list` only before Todo create/move, although the task
contract requires it before domain creation as well. This was corrected during review in all three
mirrors: the current instructions require `domain.list` before domain create, require confirmation
before an intentional same-title duplicate, and treat `domain.create` as non-idempotent after a
timeout or missing response (`.agents/skills/bitterless-todo/SKILL.md:18-28`;
`.agents/skills/bitterless-todo/references/tools.md:26-28`). The three directories are byte-identical,
and the Codex sidecar now advertises explicitly authorized domain management. This correction is
closed and is not a remaining finding.

The candidate serialization patch appeared in the shared worktree after the initial finding was
reported and was independently re-read and re-run before this review was finalized.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Public domain contract fixture | pass | `yarn test:mcp:domain-create` exited 0 in 4.13 seconds. It covered the advertised schema, trimming, invalid title/description values, active filtering, response shape, UI broadcast, deterministic concurrent limit enforcement, and queue recovery after rejection. No live bridge or database was used. |
| Concurrent limit finding | closed | The original temporary adversarial fixture reproduced 18 active domains without serialization. The checked-in snapshot/race-probe case now proves one success, one rejection, and 17 active domains through the real stdio helper; an independent delayed-snapshot check against the repaired bridge produced the same result. |
| Existing Todo smoke fixture | pass | `yarn test:mcp:todo-smoke` exited 0 in 23.78 seconds and exercised its ownership-safe lifecycle/cleanup cases entirely against the fixture. |
| Script syntax | pass | `node --check` passed for the new domain test and both source-hook/stdio fixtures. The public contract test also imported and executed the real TypeScript bridge/helper source through Node's test hooks. |
| Skill mirrors and YAML | pass, with validator environment caveat | Both three-way `diff -qr` comparisons were empty. `js-yaml` parsed all three strict frontmatters and sidecars successfully. The bundled `quick_validate.py` could not start because the host Python lacks PyYAML; that missing validator dependency is not an implementation defect. |
| Targeted lint | existing external error | Targeted ESLint reached the changed files but exited 1 on the pre-existing unused `result` parameter in `mcpStdio.helper.ts:297`, plus repository-wide Prettier-style warnings in those files. No correctness blocker was inferred from this run. |
| Patch hygiene | pass | `git diff --check` exited 0. |
| Full typecheck/build | intentionally not run | The verify constraint excludes the known high-memory full typecheck, and a full Electron build could interfere with the running DEBUG app. The real source-backed fixtures provide the lightweight compile/execution check for this round. |
| Live Bitterless writes | intentionally not run | Review constraints prohibit `domain.create`, real Todo writes, and direct SQLite reads. Live creation belongs to the orchestrator only after a passing repair review. |

## Conclusion

**pass** — the original concurrency P2 is closed with a serialized check/create queue and a
deterministic public-MCP regression that would fail the old implementation. Public schema,
validation, response shape, active filtering, UI broadcast, rejection recovery, skill policy,
three-way skill mirrors, and the existing Todo smoke regression suite all pass. The orchestrator may
now perform the task's separately authorized live DEBUG domain creation and Todo lifecycle check.
