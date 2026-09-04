---
id: eyes-on-agents-claude-title-provenance-095
scope: Record a Claude title's provenance so an Agent View rename replaces its own name without clobbering a Desktop title, and log enough per-session detail to diagnose a thread that never appears
status: done
depends-on: [eyes-on-agents-iterm2-reveal-applescript-094]
verify: focused EyesOnAgents repository/service/hook unit tests, migration audit, Core strict typecheck; no Electron
---

# EyesOnAgents Claude Title Provenance and Hook Diagnostics

## Objective

Two owner-reported problems from the packaged Preview build, one repair each. They are filed together
because the second is what made the first undiagnosable.

1. `/rename` never reaches Focus.
   [Root cause is documented](../issues/eyes-on-agents-claude-rename-does-not-propagate.md): the
   Agent View title merge is first-write-wins.
2. A renamed, freshly-created `claude2` session appeared not to sync at all — and it could not be
   determined from `main.log` whether its hook identity was captured, because the only SessionStart
   log line records a single boolean and no session id.

## What is already measured (do not re-derive)

- `/rename <name>` writes **two** transcript records — `{"type":"custom-title","customTitle":"…","sessionId":"…"}`
  and `{"type":"agent-name","agentName":"…","sessionId":"…"}` — and the new name **also** appears in
  `claude agents --json --all` as that session's `name`. So the rename already reaches Bitterless
  through the existing Agent View adapter; no transcript reading is required to fix problem 1.
- The Preview build's installed hook helper does contain the terminal/environment capture
  (`ITERM_SESSION_ID`, `TERM_PROGRAM`, `CLAUDE_CONFIG_DIR`, `terminalApp`, `claudeConfigDir`, schema
  versions through 4), so tasks 081/087 are present in that build.
- The hook outbox is empty with an mtime matching the session's last transcript write, so that
  session's deliveries were written and consumed. What is unknown is whether a **terminal identity**
  came with them — which is exactly what the missing log detail would have told us.

## Required behavior — problem 1: title provenance

- Add a `title_source` column to the Claude thread row, via a **committed migration** following this
  repo's existing migration conventions (see `src/preload/sqlite/dao/eyesOnAgents.migration.ts` and
  `coreSqlite.release.ts`; the `versionCode` must be strictly sequential and pass
  `yarn audit:sqlite-migrations`). Values: `'desktop' | 'agent_view' | 'codex' | null`, defaulting to
  `null` for existing rows.
- Every existing writer stamps its own provenance: the Desktop/inventory upsert writes `'desktop'`
  when it supplies a title, `reconcileClaudeAgentStates` writes `'agent_view'`, Codex title
  enrichment writes `'codex'`.
- `reconcileClaudeAgentStates`'s merge becomes: **the Agent View may overwrite a title it owns
  (`title_source = 'agent_view'`) or a missing title, and must not overwrite one owned by another
  source.** A poll reporting no name must still never clear a stored title.
- This preserves both existing asserted policies —
  `'Agent View names must not overwrite a Desktop conversation title'` and
  `'Agent View names may fill a missing title'` (`scripts/eyes-on-agents/repository.test.mjs`) —
  while letting a rename land. **Do not weaken either assertion**; add to them.
- A `null` `title_source` on a legacy row must be treated as *not owned by the Agent View*, so a
  pre-migration Desktop title stays protected. Note the consequence honestly: a legacy CLI-only row
  keeps its stale title until something else refreshes it, because provenance was never recorded.

## Required behavior — problem 2: diagnosable hook logging

The current line is `[claude-hook] event=SessionStart environmentAttribution=${bool}`
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:3321`). It cannot answer "did session X get an
iTerm2 identity?", which is the single most useful question when a row does not appear.

- Extend it to carry, for every hook event (not just SessionStart): the **session id**, the
  `hookEventName`, the payload `schemaVersion`, whether a terminal identity was captured and which
  `terminalApp`, and whether environment attribution was present.
- **Never log a path.** `claudeConfigDir`, `cwd` and `transcriptPath` stay booleans/absent — the
  existing `[claude-bridge]`/`[claude-watcher]` convention (id/label only) is the rule to follow.
  `ITERM_SESSION_ID` is an opaque identifier, not a path, and may be logged.
- Add one line where a Claude thread is **held back by the visibility gate** — the
  `desktopSessionId !== null || iterm2SessionId !== null` filter at
  `eyesOnAgents.service.ts:854-858`. A thread that is discovered, stored, and then silently excluded
  from every board is the exact failure the owner hit twice; it must be visible in the log, bounded
  so a large inventory cannot spam it (log a count plus the ids, or throttle — pick one and say why).

## Non-goals

- Reading `custom-title` / `agent-name` / `aiTitle` out of transcripts. It is now unnecessary for
  the rename fix, and the inventory path deliberately never opens transcripts. Worth revisiting only
  if a richer title than the Agent View's short `name` becomes the goal.
- Changing what the Agent View reports or how often it is polled.
- Backfilling `title_source` for existing rows by guessing.

## Path

- `src/preload/sqlite/dao/eyesOnAgents.migration.ts`, `src/preload/sqlite/dao/eyesOnAgents.table.ts`,
  `src/preload/sqlite/coreSqlite.release.ts` (migration + schema)
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts` (provenance stamping + the merge)
- `src/main/eyesOnAgents/eyesOnAgents.service.ts` (hook logging + visibility-gate logging)
- `src/main/eyesOnAgents/` (a log helper, if the existing ones do not fit)
- `scripts/eyes-on-agents/repository.test.mjs`, plus hook/service tests for the new log lines
- `docs/issues/eyes-on-agents-claude-rename-does-not-propagate.md` (record which option was taken)
- `docs/integrations/eyes-on-agents.md` if it documents the title contract

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`,
  `yarn test:eyes-on-agents:repository`
- `yarn audit:sqlite-migrations` and `yarn test:sqlite-migrations` (or whichever the repo defines) —
  a migration that fails the audit is a blocking defect, not a warning.
- `yarn eslint` on each touched file — no new errors.
- Do **not** run Electron, packaged builds, Playwright, or any `test:e2e:*` suite.
- Owner-only manual check, after a repackage: rename a CLI session and watch the Focus title follow;
  and confirm `main.log` now names the session and its captured terminal identity.

## Implementation evidence

### Migration

- New column: `eyes_on_agents_thread.title_source TEXT` (no default, so existing rows are `NULL`).
- Runner: `ensureEyesOnAgentsTitleSourceSchema` (`src/preload/sqlite/dao/eyesOnAgents.migration.ts`),
  `addColumnIfMissing`-based and therefore idempotent; also added to the fresh-database
  `EyesOnAgentsTable.createSql` (right after `title`) and to `finalizeCoreSqliteSchema`.
- **versionCode `260904120000`.** Previous maximum in `coreSqliteMigrations` was `260902150000`
  (`ensureEyesOnAgentsClaudeConfigDirSchema`, task 087), so the manifest stays strictly increasing.
  It also stays **below** `package.json` `version_code` `260904145513`, which
  `assertSqliteMigrationManifest` requires ("current version_code is older than migration" otherwise).
- No backfill. Guessing provenance for existing rows is a non-goal and would hand a Desktop title to
  the Agent View's short `name`.
- The audit's `eyes_on_agents_thread` column assertion now includes `title_source`, so all 14 Core
  baselines prove the column arrives, and the legacy-database drill in `repository.test.mjs` asserts
  no migrated row gains a non-`NULL` provenance.

### Provenance stamped per writer

| writer | stamps |
|---|---|
| `upsertClaudeInventory` insert + update (Desktop/JSONL inventory, hook-driven inventory) | `'desktop'` whenever it supplies a non-null `title`; preserves the stored `title_source` when it reports `title: null` (same preserve-on-null shape as `title` itself) |
| `reconcileClaudeAgentStates` (Agent View poll) | `'agent_view'`, only when it is actually allowed to write the title |
| `refreshThreadPage` (Codex title enrichment) | `'codex'` when the title changes; `NULL` if a change clears it |
| `enrichMissingThreadTitle` (Codex, fills a missing title) | `'codex'` |
| `upsertDiscoveredThreads` (Codex `thread/list` discovery) | `'codex'` on insert and on any conflict update that supplies a title |
| `applyRuntimeEventInTransaction` (Codex snapshot title repair) | `'codex'` on both the insert and the `WHERE title IS NULL` repair |
| Claude deletion projection | clears `title_source` to `NULL` alongside `title`, and the change-detection clause gained `title_source IS NOT NULL` so the projection stays idempotent |

### The merge rule, in words

The Agent View may write a title only when it reports one **and** it already owns the stored title,
where "owns" means `title_source = 'agent_view'` or there is no stored title at all. Otherwise the
stored title and its provenance are left exactly as they were. Concretely:

```ts
const agentViewMayWriteTitle = agent.title !== null &&
  (row.title === null || row.title_source === 'agent_view');
const title = agentViewMayWriteTitle ? agent.title : row.title;
const titleSource = agentViewMayWriteTitle ? 'agent_view' : row.title_source;
```

- A rename lands, because the second and every later poll sees its own `agent_view` title.
- A `desktop`- or `codex`-owned title is never replaced (the asserted policy is unchanged).
- A poll reporting `title: null` can never clear a stored title — `agentViewMayWriteTitle` is false,
  so `row.title` is written back unchanged.
- The `UPDATE`'s change guard gained `COALESCE(title_source,'') <> COALESCE(?,'')`, so the write
  fires exactly when something differs.

**Legacy behavior, stated honestly.** `title_source IS NULL` is *not* Agent-View-owned, so a
pre-migration Desktop title stays protected — and a pre-migration CLI-only row keeps its stale title
indefinitely, because provenance for it was never recorded. It becomes updatable again as soon as any
inventory or Codex writer supplies a title and records a source (covered by a test).

### Log lines

`src/main/eyesOnAgents/claudeHookLog.helper.ts`, emitted once per admitted delivery for **every**
hook event (`SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `Stop`, `StopFailure`,
`SessionEnd`), from `commitClaudeHookDeliveryInternal` *before* the transcript-validation branch it
used to be trapped inside:

```
[claude-hook] event=SessionStart session=<uuid> schemaVersion=4 terminalIdentity=true terminalApp=iterm2 terminalSession=w0t1p1:<UUID> environmentAttribution=true transcript=true
[claude-hook] event=Stop session=<uuid> schemaVersion=2 terminalIdentity=false terminalApp=none terminalSession=none environmentAttribution=false transcript=true
```

No path is ever logged: `claudeConfigDir` collapses to `environmentAttribution`, `transcriptPath` to
`transcript`, and `cwd` is absent entirely. `terminalSession` is `ITERM_SESSION_ID`, an opaque
terminal identifier, so it is safe and is the field that answers "did session X arrive with an iTerm2
identity?" directly. A test asserts no emitted line contains `/`, matching
`claudeIterm2Log.helper.ts`'s convention.

`src/main/eyesOnAgents/claudeVisibilityLog.helper.ts`, emitted from `getSnapshot` when the
`desktopSessionId !== null || iterm2SessionId !== null` gate holds Claude rows back:

```
[claude-visibility] gate=terminal_identity_missing held=7 named=5 ids=claude:<uuid>,claude:<uuid>,claude:<uuid>,claude:<uuid>,claude:<uuid>
```

**Bounding choice — cap plus change-detection, both, because either alone still spams.**
`getSnapshot` runs on every renderer read and after every notify, so a per-call line would flood the
log even for a single held thread; and a large inventory would produce a single unreadable line. So
(1) at most `CLAUDE_VISIBILITY_GATE_LOG_ID_LIMIT = 5` session keys are named while `held=` keeps the
true total, and (2) the service remembers the last line it emitted and logs only when the line
changes, so a steady-state hold is logged once and a thread that gains an identity (or a provider
disable/enable) produces a new line. Throttling by time was rejected: it would either hide a change
that happens inside the window or keep re-logging an unchanged hold forever. Only the
identity-missing case is logged; rows hidden because the Claude provider is switched off are expected
and are reported as an empty hold.

### Tests

- `scripts/eyes-on-agents/repository.test.mjs` — both original policy assertions left byte-identical;
  added, immediately after them: `title_source` is `'desktop'` on the inventory-supplied title and
  `'agent_view'` on the filled one; a rename lands on the Agent-View-owned title; a `title: null`
  poll changes nothing; a Desktop-owned title survives a later poll; a row forced to
  `title_source = NULL` (simulating a pre-migration row) is not treated as Agent-View-owned; a later
  inventory title records provenance and unsticks that legacy row. Also added the `title_source`
  column/`NULL`-provenance drill to the legacy-database migration section.
- `scripts/eyes-on-agents/claude-diagnostic-logging.test.mjs` — **new file** (registered in
  `test:eyes-on-agents:claude`), 7 tests: the exact line for all six hook events, the
  terminal-identity + attribution SessionStart line, a delivery whose transcript validation throws
  still logs, the pure line builder, the bounded/deduped visibility-gate line, a held thread that
  gains an identity, and the empty-hold `null`.
- `scripts/eyes-on-agents/claude-hook-environment-attribution.test.mjs` — its two log assertions were
  adjusted to the widened line (they matched `event=SessionStart environmentAttribution=true` as one
  contiguous string). They now assert `event=SessionStart session=` *and* the attribution boolean,
  and still assert the raw `CLAUDE_CONFIG_DIR` never appears. No test was weakened or removed.

### Docs updated

- `docs/issues/eyes-on-agents-claude-rename-does-not-propagate.md` — status flipped to repaired and a
  **Resolution** section records that **Option 1** was taken (Option 2's premise is still unverified
  and needs transcripts the inventory path deliberately never opens), with the merge snippet and the
  legacy-`NULL` cost.
- `docs/features/eyes-on-agents-claude-observation.md` — the fill-only sentence ("Active
  `claude agents` names may repair a missing title") is now followed by the provenance-ownership
  rule, so the shipped contract no longer reads as fill-only.
- `docs/integrations/eyes-on-agents.md` — `title_source` added to the `eyes_on_agents_thread` column
  table.
- `docs/plan/README.md` / `docs/INDEX.md` were **not** touched: the eyes-on-agents rows there stop at
  task 072 (task 094 is unregistered too), and both files carry unrelated concurrent edits.

### Verification (final output lines)

```
$ yarn typecheck:eyes-on-agents:core        -> Done in 2.04s.
$ yarn typecheck:eyes-on-agents:ui          -> Done in 2.76s.
$ yarn audit:sqlite-migrations              -> SQLite migration audit passed (14 Core + 7 Maestro + 10 Todoist sync + 8 Trench baselines).
$ yarn test:sqlite-migrations               -> tests 37 / pass 37 / fail 0
$ yarn typecheck:sqlite-migrations          -> Done in 1.22s.
$ yarn test:eyes-on-agents:repository       -> EyesOnAgents repository tests passed
$ yarn test:eyes-on-agents:claude           -> node --test groups: 27/27, 17/17, 1/1, 61/61 (was 54/54 before the new file: +7); every script group printed "... tests passed"; Done in 11.74s.
$ yarn test:eyes-on-agents:ui               -> tests 106 / pass 105 / fail 1
$ yarn test:eyes-on-agents:core             -> EyesOnAgents core tests passed
$ yarn test:eyes-on-agents:project-resolver -> EyesOnAgents Project resolver tests passed
$ yarn test:eyes-on-agents:app-server       -> EyesOnAgents App Server tests passed
$ yarn test:eyes-on-agents:bridge           -> EyesOnAgents Codex bridge / durable hook delivery tests passed
```

`:ui` is at its documented baseline: the deterministic `ui-source.test.mjs` bundle-id assertion
(`io.bitterless.desktop_dev`, about untouched `src/main/index.ts`) fails on every run, and the
`thread-card-open-capability.test.mjs` right-click test is the known flake (failed on 2 of 3 runs
here, passed on the other). No third failure; test total unchanged at 106.

`yarn eslint` on every touched file: **0 new errors.** The only error in touched TypeScript is the
pre-existing `prefer-const` at `eyesOnAgents.service.ts:1330`. The new `.mjs` test file reports 10
`@typescript-eslint/explicit-function-return-type` errors — structurally unavoidable in a `.mjs`
script and identical in kind and count to its sibling `claude-visibility-lifecycle.test.mjs` (10) and
every other test script in that directory. Prettier warnings on the two new helpers match the style
of the shipped `claudeIterm2Log.helper.ts`, which reports the same ones.

### Not verified / known gaps

- No Electron, packaged build, or `test:e2e:*` run. The owner-only manual check in **Verify** above
  (rename a CLI session, watch the Focus title follow; confirm `main.log` names the session and its
  terminal identity) still needs a repackage.
- The migration was exercised only through the audit harness and unit fixtures, never against the
  owner's real (SQLCipher) database.
- A hook delivery dropped by the provider-enable cutoff (`occurredAt <= claudeProviderEnableCutoff`)
  returns before the log line and is therefore still unlogged. That admission gate is out of this
  task's scope, but it is the one remaining silent Claude-hook drop.
- `yarn typecheck:mcp` fails on `src/main/mcp/mcpAgentOnboarding.service.ts` (TS5097, a `.ts` import
  extension) from unrelated concurrent MCP work in commit `cb274e6`; not touched here.
