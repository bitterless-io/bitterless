# A renamed Claude session keeps its old title in Focus

Status: Root cause confirmed. **Repaired in source by
[task 095](../plan/tasks/eyes-on-agents-claude-title-provenance-095.md) via Option 1 (record title
provenance)**; owner runtime verification pending a repackage — see "Resolution"

Reported: 2026-09-04, by the owner, from the packaged Preview build

## Symptom

Renaming a Claude Code session with `/rename` does not change the thread's title in Focus. The row
keeps whatever name it was first discovered with, indefinitely.

## This is a defect

Thread titles are meant to track the provider. The Codex side re-reads titles through title
enrichment; the Claude side has an authoritative live source and ignores it after the first read.

## Root cause: one line, first-write-wins

`EyesOnAgentsRepositoryDao.reconcileClaudeAgentStates`
(`src/preload/sqlite/dao/eyesOnAgents.dao.ts:2331`) merges the Agent View's reported title into the
stored row as:

```ts
const title = row.title ?? agent.title;   // :2331  existing value wins, forever
const cwd = agent.cwd ?? row.cwd;         // :2332  provider wins — the correct shape
```

The two adjacent lines disagree, and only `cwd` is right. Once a row has *any* title, `row.title`
is truthy on every subsequent poll, so the provider's current title can never replace it. The
surrounding `UPDATE` even guards on `COALESCE(title,'') <> COALESCE(?,'')` (`:2352`) and would
happily write a changed title — the value handed to it is simply pinned to the old one before it
gets there. Nothing about the intent is documented, and the inconsistency with `cwd` on the very
next line reads as an oversight rather than a policy.

## Evidence that the rename really is available to us

`claude agents --json --all` is the Agent View source
(`src/main/eyesOnAgents/claudeAgents.adapter.ts:120-127`), and its `name` field is what the adapter
maps to `title` (`:66`, `item.name ?? item.title`). Measured on the owner's machine, it reports 8
sessions including this one, and the names are plainly user-controlled — auto-generated ones look
like `overmind-db` / `overmind-c0`, while renamed ones look like `bitterless onlypreview`,
`crms-workflow`, `CRMS DESKTOP`. So the renamed value reaches Bitterless on the very next poll and
is then discarded by the line above.

## Why no other writer is at fault

- The transcript inventory adapter never opens the JSONL — it stats the file and takes the id from
  the filename, with `title: null` on every row
  (`src/main/eyesOnAgents/claudeTranscriptInventory.adapter.ts:77,94`). It contributes no title.
- The inventory upsert therefore uses `title: thread.title ?? row.title`
  (`eyesOnAgents.dao.ts:2223`), preserve-on-null, which is **correct there**: an adapter with no
  title must never clobber a real one. That is the same shape as the buggy line but for the opposite
  and valid reason, which is probably how the bug got copied in.
- Title enrichment is a Codex-only path (`eyesOnAgents.service.ts:1369-1381` parses a
  `Codex thread/read` response) and never writes Claude titles.

So the Agent View is the single authoritative title source for a CLI Claude session, and it is the
one being thrown away.

## Why the obvious fix is wrong

Flipping the merge to `agent.title ?? row.title` was tried and **reverted**. It breaks an existing,
deliberate policy, asserted in `scripts/eyes-on-agents/repository.test.mjs`:

- `'Agent View names must not overwrite a Desktop conversation title'` (`:3591`) — the Agent View
  reports only a short `name` (`overmind-db`), which must not replace the richer Claude Desktop
  conversation title.
- `'Agent View names may fill a missing title'` (`:3597`) — filling a blank is allowed.

Read together, the shipped rule is exactly *"the Agent View may fill a missing title, but may never
overwrite one"* — under which a rename can never propagate, by construction. The two assertions and
the reported symptom cannot all be satisfied without new information.

A second attempt gated the flip on `row.desktop_session_id === null` (Agent View wins only for a
CLI-only thread). That is the right *shape*, but `desktop_session_id` turned out to be an unreliable
proxy: the Desktop-titled thread in that test reaches the reconcile with a **null**
`desktop_session_id` while still holding its Desktop-sourced title, so the guard let the overwrite
through and the original assertion failed. Also reverted.

The blocker is that the schema records a title's **value** but not its **provenance**, so
"overwrite an Agent-View name" and "overwrite a Desktop title" are indistinguishable at the merge.

## Options

1. **Record title provenance.** Add a `title_source` column (`desktop` / `agent_view` / `codex`) and
   let the Agent View overwrite only titles it set itself. Precise, satisfies all three constraints,
   costs a migration.
2. **Read `aiTitle` from the transcript instead.** The transcript carries `type: 'ai-title'` lines
   with Claude's own generated title — e.g. "Build iTerm2 and multi-environment support for
   EyesOnAgents" — which is *richer* than both the Agent View `name` and arguably the Desktop title,
   and is appended over time so it can update in place. Bitterless never reads it today
   (`grep -rn "aiTitle\|ai-title" src/ scripts/` is empty). No migration. **Unverified premise:**
   whether `/rename` writes a new `ai-title` line. In one measured session all 104 lines were
   identical, so nothing there proves it either way — a single `/rename` in a live session would
   settle it, and it also means opening transcripts the inventory path deliberately never opens.
3. **Accept it and change the docs.** Declare the Agent View name fill-only and say renames do not
   propagate. Cheapest, and dishonest to the user's expectation — not recommended.

Recommendation: **2 if the premise holds, else 1.** Option 2 gives a better title for every CLI
session, not just renamed ones, and avoids a migration; option 1 is the safe fallback.

## Resolution — Option 1 (record title provenance)

Option 2's premise (that `/rename` appends a fresh `ai-title` line) is still unverified, and it
requires opening transcripts that the inventory path deliberately never opens, so task 095 took
**Option 1**. `eyes_on_agents_thread.title_source` (`desktop` / `agent_view` / `codex` / `NULL`) is
added by migration `260904120000`, every title writer stamps its own source, and the merge becomes:

```ts
// EyesOnAgentsRepositoryDao.reconcileClaudeAgentStates
const agentViewMayWriteTitle = agent.title !== null &&
  (row.title === null || row.title_source === 'agent_view');
```

so the Agent View may replace a title it owns (the rename lands) or fill a missing one (unchanged
policy), and may never touch a `desktop`/`codex`-owned title. `title_source IS NULL` on a legacy row
counts as unowned, which keeps a pre-migration Desktop title protected; the honest cost is that a
legacy CLI-only row keeps its stale title until an inventory or Codex writer refreshes it and records
a source. Both original assertions in `scripts/eyes-on-agents/repository.test.mjs` still pass
unmodified, with new cases covering the rename, the null-name poll, the legacy-`NULL` row, and the
provenance stamped by each writer.

Option 2 remains open only as a *richer title* idea, not as this bug's repair.

## Not covered by this issue

Beyond the repair above, no behavior was changed: the visibility gate, Agent View polling cadence,
and everything the Agent View reports are untouched.
