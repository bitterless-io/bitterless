# Review: todo-mcp-multi-instance (round 1)

## Findings

None. No P1, P2, or P3 implementation finding remains after the verification fixes.

## Contract review

| Contract | Result | Evidence |
|---|---|---|
| Production and DEBUG identities stay distinct | pass | App-name routing maps the canonical app to `bitterless` and normalized variants such as `Bitterless_DEBUG` to a suffixed server name (`src/shared/mcp/mcpBridge.shared.ts:25-35`). Endpoints derive from each instance's own `userData` path, with a per-path named-pipe hash on Windows and a profile-local Unix socket elsewhere (`mcpBridge.shared.ts:37-49`). |
| Generated helpers pin the intended endpoint | pass | POSIX and Windows shims include one explicit `--mcp-bridge-path` before forwarding client arguments (`mcpBridge.shared.ts:88-118`); helper parsing rejects duplicate, inline, empty, relative-Unix, and non-local-Windows forms (`mcpBridge.shared.ts:120-149`). The DEBUG live helper contained the exact `Bitterless_DEBUG/mcp/bridge.sock` path. |
| Legacy helper fallback remains compatible | pass | The stdio helper uses the explicit endpoint when supplied and otherwise derives the legacy endpoint from its own Electron `userData` (`src/main/mcp/mcpStdio.helper.ts:414-417`). Focused tests execute both pinned and legacy routes. |
| Core SQLite readiness gates the bridge, not Qdrant | pass | Main awaits the typed `CoreSqliteBootDao.ready()` result before starting the MCP bridge, and shim generation is a separate failure boundary (`src/main/app.main.ts:207-239`). The preload completes SQLite boot before starting optional tiktoken/message/Qdrant services (`src/preload/sqlite/sqlite.preload.ts:98-134`). |
| Unix live/stale/ownership races are safe | pass | Startup atomically publishes a complete lock via a candidate hard link, reclaims dead or identity/age-guarded malformed legacy locks, rejects responsive sockets and non-socket paths, and only unlinks an unchanged stale socket (`src/main/mcp/mcpBridge.server.ts:145-315,675-723`). Shutdown preserves and immediately restores a replacement route before awaiting old clients (`mcpBridge.server.ts:729-790`). |
| DAO absence and invalid shapes fail explicitly | pass | Shared exact DAO interfaces are implemented by the three preload DAOs (`src/shared/mcp/todoMcpDao.type.ts:84-138`; `src/preload/sqlite/dao/domain.dao.ts:15`; `todo.dao.ts:108`; `todoEvent.dao.ts:106`). Bridge validators cover domain, todo, event, status, update, move, and delete results; `null`/`undefined` cannot become a successful mutation (`src/main/mcp/mcpBridge.server.ts:318-566,1090-1186`). |
| CRUD timestamp clearing and alias handling are correct | pass | Explicit `dueAt: null` and `remindAt: null` survive parsing, while conflicting camel/snake aliases reject before DAO or broadcast (`mcpBridge.server.ts:620-637,1208-1212`; `scripts/mcp/multi-instance.test.mjs:511-535`). |
| Smoke CLI targets are explicit | pass | `--profile production|debug` maps to the two standard helper paths, conflicts with `--helper` are rejected, and the existing environment override remains supported (`scripts/mcp/todo-smoke.mjs:75-78,96-171`). No profile is inferred from whichever GUI happens to answer. |
| Skill remains production-safe | pass | All three copies are byte-identical. The sidecar depends only on MCP server `bitterless`; the skill names DEBUG aliases as test-only and requires explicit authorization before selecting them (`.agents/skills/bitterless-todo/agents/openai.yaml`; `.agents/skills/bitterless-todo/SKILL.md:12-15,52-63`). |

## Fault injection

- A malformed legacy `<socket>.start-lock/owner.json` plus two simultaneous starters recovered in
  505 ms. Exactly one server started, the loser rejected the live owner, the lock disappeared, and
  the winning route remained reachable.
- An old server was held open by a client while its pathname was replaced by another live server.
  Calling `stop()` on the old owner kept the replacement path present and connectable both during
  and after shutdown.
- The focused suite additionally covers a real stale Unix socket created by a killed child, a
  non-socket collision, missing lock metadata, pinned helper routing, POSIX quoting, simulated
  Windows batch quoting, strict argv parsing, and every invalid/null DAO result.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn typecheck:mcp` | pass | Strict MCP TypeScript graph completed with `noCheck: false`. |
| `yarn test:mcp:multi-instance` | pass | Routing, pinned/legacy helpers, POSIX/Windows quoting, lock/socket races, replacement ownership, timestamp clearing, and DAO readiness/shape validation passed. |
| `yarn test:mcp:domain-create` | pass | Public schema, validation, serialized active-domain limit, recovery, and UI broadcast passed. |
| `yarn test:mcp:todo-smoke` | pass | Lifecycle, ownership-safe cleanup, ambiguous settlement, and helper shutdown cases passed. |
| `yarn build` | pass | Main, preload, and renderer bundles completed. Vite emitted only the existing Home router mixed static/dynamic import warning. |
| `git diff --check` | pass | No whitespace errors. |
| Skill parity and YAML | pass | `diff -qr` was silent for `.agents`, `.claude`, and `~/.codex`; all frontmatter and `agents/openai.yaml` files parsed, with only the production `bitterless` MCP dependency. |

Windows behavior was exercised through platform-parameterized source tests and an actual `.cmd`
fixture; this macOS verification host could not run a native Windows named-pipe process.

## Live dual-instance acceptance

- The installed production GUI remained PID `41351` throughout. Its production socket stayed inode
  `169833807`; no production process was stopped, restarted, or written through MCP.
- `yarn dev:prod` started the current DEBUG source on
  `~/Library/Application Support/Bitterless_DEBUG/mcp/bridge.sock` and automatically replaced the old
  unpinned DEBUG helper with a helper pinned to that exact socket.
- `yarn mcp:todo:smoke --profile debug --read-only` passed against domain `1:Others`.
- Full DEBUG smoke created todo `2`, verified get/update/complete/status/uncomplete/status/delete, and
  verified cleanup. A concurrent DEBUG read-only probe also passed while the production probe ran.
- Only the DEBUG dev session was stopped afterward. The dev runner's Ctrl-C left a refused/stale
  DEBUG socket pathname, which the independently verified startup recovery path removes on the next
  `yarn dev:prod` run. Production PID and socket inode were unchanged after shutdown.

## Deployment note

The currently installed `/Applications/Bitterless.app` predates this patch. Its helper shim is absent,
and a read-only direct helper probe can initialize and list tools but fails `domain.list` with
`Cannot read properties of null (reading 'filter')`. This is not a failure of the reviewed source:
the current DEBUG build passed the same real SQLite path and full lifecycle. Production MCP becomes
usable after Ral upgrades/restarts the production app at a convenient time so it runs this build and
auto-generates `~/Library/Application Support/Bitterless/bin/bitterless-mcp`. No production write was
used to establish this conclusion.

## Conclusion

**pass** — the source and generated helper design isolate production and DEBUG endpoints, recover
ownership races without clobbering a live route, fail closed on unavailable/invalid SQLite results,
and expose explicit CLI/skill targeting. The remaining production limitation is a known installed-
build deployment gap, not a source blocker; resolving it requires a later production app upgrade,
not closing production during normal DEBUG development.
