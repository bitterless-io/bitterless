---
id: tool-output-prune-001
scope: Prune historical snapshot tool outputs before Pi compaction
status: done
depends-on: [pi-native-compaction-001]
verify: node --test tests/maestro/maestroPruneToolOutputs.test.mjs
---

# Prune historical tool outputs before compaction

Design contract: `areas/agent-runtime/chat/compaction/compaction.html` **#7** (已定 2026-09-22).
Incident evidence: `areas/agent-runtime/chat/compaction/compaction-closeout1.md` B1–B3.

## Why

A 2026-09-22 Maestro session failed with `context_length_exceeded` after 26 tool calls in a single
turn. Measured from the session's own diagnostic records:

| Tool | Calls | Total chars | Largest single |
|---|---|---|---|
| `page_snapshot` | 26 | 171,220 | 16,186 |
| `read_file` | 5 | 131,873 | **120,049** |
| other 13 tools | 52 | 10,327 | 462 |

Two distinct defects, needing different fixes:

1. **Cumulative** — 26 individually normal snapshots pushed the context from ~60K to 268K.
2. **Single oversized** — one `read_file` returned a whole HTML document.

Pi cannot express either fix. Its compaction selects by **position only**: `isCutPointMessage`
returns `false` for every `toolResult`, and `findCutPoint` walks back until
`keepRecentTokens` is reached. There is no per-tool, per-size or per-age filtering. Pi already
truncates tool results to `TOOL_RESULT_MAX_CHARS = 2000` **inside the summarization request**, so
compaction itself is not expensive — the cost is the climb before it triggers.

## Decisions (Ral 2026-09-22)

| Parameter | Value |
|---|---|
| Tool rounds kept verbatim | **2** |
| Prunable tools | `page_snapshot`, `read_file` |
| Behavior on budget overflow | **must converge on compaction (self-healing); never a dead end** |
| `gpt-5.6` family context window | **256K** |
| Scope | CoWork **and** Bitterless, docs before code |

A "round" is one assistant response plus its tool results, **not** one user turn. With the
user-turn reading, all 26 snapshots sit inside the most recent turn and nothing would be pruned —
that reading cannot solve the reported problem.

## Hook placement (decisive)

| Hook | Site | Fires | Mutates | Visible to `shouldCompact` |
|---|---|---|---|---|
| `prepareNextTurnWithContext` | `agent-loop.js:90`, inside the tool loop | every assistant response except a run's first | replaces `currentContext` | **yes** |
| `transformContext` | `agent-loop.js:180` | **every** request, including a run's first | provider payload only, not written back | **no** |

Pruning in `transformContext` alone shrinks the payload but leaves `shouldCompact` reading the
un-pruned messages, so compaction still runs on full text. Pruning in
`prepareNextTurnWithContext` alone misses each run's first request, because that hook is guarded
by `if (lastCompletedTurn)` while `createContextSnapshot()` rebuilds full history from
`state.messages.slice()`. **Both hooks, one shared pure function.**

Ordering works in our favour: Pi installs its own wrapper in the `AgentSession` constructor
(`agent-session.js:157`), so a host wrapper added afterwards is the **outer** one and runs first.
Passing the pruned `turn` inward means `shouldCompact` sees the reduced size in the same call,
with no one-round lag.

## Steps

1. `src/main/agent/runtime/pruneToolOutputs.ts` — pure, idempotent. Map
   `toolCallId` → tool name from assistant `toolCall` blocks; keep the last 2 tool rounds
   verbatim; replace earlier `page_snapshot` / `read_file` results with a one-line placeholder
   carrying the original character count.
2. Wire it into `prepareNextTurnWithContext` in `piRuntimeSession.ts` (prune, then delegate
   inward so Pi's threshold check reads the pruned context).
3. Wire the same function into `transformContext` in `piRuntimeSession.ts`, ahead of the
   existing skill-catalog refresh.
4. Bitterless has no skill-catalog gate, so the gate repair in the CoWork task does not
   apply here. Everything else is identical.

## Verification

Scoped unit tests plus scoped TypeScript, per `pi-native-compaction-001`. **No live provider
request, app build or Electron E2E** — Ral runs E2E himself.

### Result — 2026-09-22

Steps 1–3 shipped here; step 4 does not apply (no skill-catalog gate here). **Step 5 was not done
by this task — it was already done**, on both sides, by a concurrent session; see the section at
the end.

- PASS **13/13** new: `node --test tests/maestro/maestroPruneToolOutputs.test.mjs`.
- PASS **44/44** together: `node --test tests/maestro/maestroPiCompactionPolicy.test.mjs tests/maestro/maestroPiNativeCompaction.test.mjs tests/maestro/maestroPruneToolOutputs.test.mjs`.
- PASS strict scoped types on the new module:
  `node node_modules/typescript/lib/tsc.js --noEmit --strict --target es2022 --module node16 --moduleResolution node16 --skipLibCheck src/main/agent/runtime/pruneToolOutputs.ts`.
- `yarn typecheck:node` reports 66 distinct diagnostics across surfaces, **0 of which name
  `piRuntimeSession` or `pruneToolOutputs`**. That surface is already red at HEAD
  (`docs/issues/typecheck-is-a-false-green.md` also quarantines three preload surfaces for tsc OOM),
  so the baseline is unchanged by this task.
- `pruneToolOutputs.ts` is **byte-identical** to the CoWork copy.
- Not run, per the owner: live provider request, app build, Electron E2E.

### Known boundary — compaction still summarizes the un-pruned text

`shouldCompact` now reads the pruned context, so needless compactions stop happening. But when
compaction *does* run, Pi's `_runAutoCompaction` works from `agent.state.messages`, which is the
append-only session store and still holds the original tool output. So the summary is built from
full text, not from the placeholders. This is acceptable and was not changed: Pi already caps each
tool result at `TOOL_RESULT_MAX_CHARS = 2000` inside the summarization request, so the cost is
bounded, and a summary built from the original text is strictly better than one built from
placeholders. Worth knowing before anyone tries to explain a summary that mentions content the
context no longer shows.

### Step 5 was already done elsewhere — not by this task (2026-09-22 12:17)

This task planned to leave the per-call tool output cap in `compaction-closeout1.md` B1. On
checking, it was already implemented in **both** projects by a concurrent session: a new untracked
`files/readGate.ts` whose limits are copied verbatim from Pi's built-in `read`
(`DEFAULT_MAX_LINES = 2000`, `DEFAULT_MAX_BYTES = 50 * 1024`, whichever is hit first, never a
partial line). `read_file`'s description and its `offset`/`limit` parameters are synced on both
sides, and a single line over 50KB returns no content at all — it hands the model
`Use bash: sed -n 'Np' <path> | head -c 51200`, the same escape hatch as Pi's `tools/read.js`.

**It also corrects this task's attribution.** That `read_file` result was not uncapped — the cap
was set in **120,000 characters**. The file was 150 lines of HTML whose two longest lines were
64,435 and 51,595 characters of base64 font data, so `limit: 2000` constrained nothing, while
120,000 characters came to roughly 72,541 tokens (27% of the window) with none of the document
body included. Bytes are the only unit that bounds ASCII, CJK and base64 alike: 50KB lands at
12–17k tokens for all three. The measured 118KB / 72,915-token figure stands; the word "uncapped"
does not.

One code fix was made here. Both ends' contract test passed a cwd-relative path to esbuild
`entryPoints`; both now resolve it from the test file itself
(`resolve(import.meta.dirname, '../..')`, the existing convention in each repo). The symptom was
asymmetric: CoWork is a monorepo with its source under `apps/cowork/`, so `node --test` from the
repository root failed with `Could not resolve "src/main/files/readGate.ts"` and only happened to
work through `yarn test:read-gate`, which runs in the workspace directory; Bitterless is a single
package whose root matches, so it only broke when run from a subdirectory. Both are now 12/12 from
the repository root, from a subdirectory, and through the yarn script.

Correction: an earlier note in this task claimed Bitterless had no test for the gate. It does, at
`tests/files/readGate.test.mjs` — the earlier check only looked in `tests/maestro/`, and because
`tests/files/` is an untracked directory, `git status --porcelain` collapses it to the directory
name, so filtering by file name did not show it. A duplicate test created on that wrong premise
was deleted.
