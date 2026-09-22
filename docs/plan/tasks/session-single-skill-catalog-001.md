---
id: session-single-skill-catalog-001
scope: One skill catalog per session, not one per message
status: done
depends-on: [tool-output-prune-001]
verify: node --test tests/maestro/maestroKeepLatestSkillCatalog.test.mjs
---

# One skill catalog per session

Owner decision, Ral 2026-09-22: **技能目录在一个会话里应该只有一份**.
Design contract: `areas/agent-runtime/chat/compaction/compaction.html` #8.

## Evidence

Bitterless session `20260922150041068-hd7kgp9lks5mu9mdcjw` — four short turns, the longest user
input about 100 characters, and compaction fired. Measured from that session's own records with
the o200k tokenizer:

| Turn | Characters | Tokens |
|---|---|---|
| 1 | 186,458 | 57,083 |
| 2 | 186,594 | 57,125 |
| 3 | 186,456 | 57,046 |
| 4 | 186,472 | 57,058 |
| | | **228,312** |

A 256K window reserving 20% compacts above **204,800**. Four short messages cleared it.

**92.1% of every message is the same skill catalog, rendered three times:**

| Block | Source | Tokens | Entries |
|---|---|---|---|
| `<available_skills>` XML | `agentPrompt.ts:282` `formatSkillsForPrompt(params.briefs…)` | 11,242 | 64 |
| `Host skill references and recording inputs:` + raw JSON | `agentPrompt.ts:287` `JSON.stringify(params.briefs)` — **same array, same expression** | 23,448 | 65 |
| `[Current complete Skills catalog]` + JSON | `skillRegistry.service.ts:78` `catalogPrompt()`, injected at `agentPrompt.ts:423` | 17,866 | 63 |
| | | **52,556** | |

They are the same catalog: C ∩ A = 64 of 68 names, A ∩ B = 63 of 65. The XML is a strict field
subset of the JSON. The raw-briefs JSON adds nothing over the registry catalog except the two
builtin entries (`builtin:drill`, `builtin:deep-fetch`) and their `triggers`; its other
"unique" fields are renames (`id`/`reference`→`ref`, `layer`/`scope`→`source`,
`skillRevision`→`revision`) or dead (`inputs` 0/65, `missing` 0/65, `triggers` 2/65).

## Two separate defects

**① Three renderings per message — Bitterless only.** CoWork removed the XML duplicate on
2026-09-18 on Ral's instruction (「技能目录用 JSON 和 XML 两种格式各渲染了一遍。只需要一种……
只要 json 就够了」), recorded in `skillCatalogPrompt.ts`. Bitterless never received that change
and additionally carries a third copy. Verified: CoWork user messages contain
`<available_skills>` 0 times and `Host skill references` 0 times.

**② One catalog per message, accumulating — both projects.** Every user message carries its own
copy and older ones are never removed. CoWork's `refreshModelSkillCatalog` says so in its own
comment: "Replace only the last host-owned turn catalog. Older messages remain immutable history."
Measured on the CoWork incident payload: **6 of 6** user messages carry `<host_skill_catalog>`.
Bitterless: **4 of 4**. This is what Ral's instruction targets — the catalog belongs to the
session, not to each message.

## Steps

1. `keepLatestSkillCatalog.ts` — shared pure function, byte-identical in both projects. Keeps the
   catalog block in the **last** user message that carries one and replaces it in every earlier one
   with a single line naming the revision it was replaced by. Idempotent, does not mutate its input.
2. Call it in `transformContext` in `piRuntimeSession.ts`, alongside `pruneToolOutputs`. That
   hook is payload-only (`agent-loop.js:180` does not write back to `currentContext.messages`),
   so the stored session keeps full history while the provider sees one catalog.
3. Bitterless only — `agentPrompt.ts`: drop the `formatSkillsForPrompt(...)` XML and the
   `JSON.stringify(params.briefs)` raw dump; keep `params.catalog` as the single source and pass
   through only the builtin entries it filters out, so nothing is lost.
4. Bitterless only — `skillRegistry.service.ts`: wrap `catalogPrompt()` output in the same
   `<host_skill_catalog>` / `</host_skill_catalog>` markers CoWork uses, so step 1 works on one
   shared delimiter.

## Verification

Scoped unit tests plus scoped TypeScript. **No live provider request, app build or Electron E2E.**

### Result — 2026-09-22

- PASS **12/12** new: `node --test tests/maestro/maestroKeepLatestSkillCatalog.test.mjs`.
- PASS **68/68** across the catalog, prune, read-gate and pi compaction suites.
- `tests/skillsThreeSources/` is 68 pass / 3 fail — the **same three names that fail at HEAD**
  with `agentPrompt.ts` and `skillRegistry.service.ts` restored (verified by hash-checked swap).
- `yarn typecheck:node` reports 66 distinct diagnostics, **identical to the baseline** measured
  with this task's changes removed. An earlier reading of 72 (6 × TS2304) was transient: this is a
  shared worktree and a concurrent session was mid-edit. Two consecutive clean runs confirm 66.
- `tests/skillsThreeSources/catalog.test.mjs` had one assertion pinning the old rendering
  (`251` × `<skill>` XML built from `briefs`). Rewritten to the new contract: briefs render no
  second catalog, builtins still come through with their `triggers`, and `params.catalog` passes
  through exactly once.
- Removed imports that this change made unused: `formatSkillsForPrompt`,
  `createSyntheticSourceInfo`, `dirname`.
- Measured on the incident session, recomputing with the new code: one message
  **57,083 → 22,674 tok (−60.3%)**; four turns **228,332 → 37,218 tok (−83.7%)**, against a
  204,800 threshold.
- Not run, per the owner: live provider request, app build, Electron E2E.

### Follow-up — A8 relocation and `/reload-skills` (2026-09-22)

Ral corrected the placement the same day: **「每次发消息都要带上的系统提示词，并不包含：完整技能目录。
只有 D1-D4 现在」**, then **「属于表 1 A8 的内容，bl cowork 都要有」**. The catalog is not a per-message
item at all — it belongs in the system prompt as **A8** of 表 1
(`overmind:areas/agent-runtime/chat/prompt-structure.html`).

- Catalog now enters through `createPiResourceLoader().getAppendSystemPrompt()` — Pi's own append
  hook, read by `_rebuildSystemPrompt()` at `agent-session.js:753`. It is sent once per request and
  never accumulates across turns, and `session.reload()` rebuilds it.
- The per-turn block keeps only D1–D4 plus the built-in text workflows (281 tokens), which Pi's own
  skill list cannot carry because `toPiSkills()` filters `path && path !== 'builtin'`.
- `skillPrompt` was reverted to `formatSkillsForPrompt`: it is the **verification mirror** used by
  `setSystemPrompt()` to recompute what Pi will produce, not an injection point. Changing it would
  only break the comparison.
- `keepLatestSkillCatalog` stays as a no-op safety net — with the catalog out of messages it finds
  no fence and returns the input unchanged.

**`/reload-skills`**, built as a builtin skill per Ral's 「先做一个 /reload-skills 这是最小范围的需求，
并配置为 built in 技能」: `builtin:reload-skills` plus a host tool `reload_skills`. It covers the one
case the automatic path cannot: skills edited **outside** the app (an editor, `git pull`, another
agent session) never touch the host cache, so an already-running Chat could only pick them up by
starting a new one. Edits made through the app's own skill tools already bump `resourceRevision`,
and `PiRuntimeSession.prompt()` calls `session.reload()` before the next message.

The name deliberately does not reuse Pi's `/reload`, which also reloads keybindings, extensions,
prompts, themes and context files; the same name would imply the same scope.

### Follow-up — B4: session-level static guidance moved to 表 2 (2026-09-22)

`CoworkAgent` / `MaestroAgent` were both `extends BaseAgent {}` with an empty `systemPrompt()`, so
the browser discipline, small-talk escape hatch, search discipline, skill-matching block and the
drill route were all concatenated into **every user message**. They interpolate nothing and have
nothing to do with the current turn, so an N-turn chat sent them N times.

They are now `STATIC_TURN_GUIDANCE`, returned by each subclass's `systemPrompt()` and therefore
part of 表 2. Measured: **≈2,600 tokens per turn removed in CoWork** (513 for the literal block,
1,697 for `DRILL_ROUTE`, 390 for `DEEP_FETCH_WORKFLOW`) and **≈2,450 in Bitterless**.

**Why not the A8 route.** A8's catalog hangs off the Pi resource loader's
`getAppendSystemPrompt()` because it must be rebuilt by `session.reload()`. Static guidance never
needs rebuilding, and — decisively — the same turn prompt serves **both the Pi and the AI-CRMS
runtime**, while that hook belongs to Pi alone. Moving it there would have silently dropped these
instructions for AI-CRMS. `BaseAgent.fullSystemPrompt()` is the assembly point both runtimes share.

**Not moved:** the skill-installer guidance (interpolates `skillAuthoringRoot` / `skillRuntime`,
which change when the workspace changes) and the workspace body. That matches the existing 表 1
A6 / D2 decision — the path fact goes to D2, the guidance stays where it is.

Guards updated on both sides, each with an added reverse assertion that the constant has **not**
come back into the per-turn message:
- `drillIsABuiltinSkill` — route now asserted against `STATIC_TURN_GUIDANCE`, plus a new
  「路由不再每轮重发」 case.
- `turnPromptFencesTheRequest` — the escape-hatch assertions likewise.

Verification: CoWork **107/108** across the prompt, catalog, prune, read-gate and pi compaction
suites, and its turn-prompt guards are **12/15 — the same three failures, by name, as HEAD**.
Bitterless turn-prompt guards **9/12 — again the same three as HEAD**; drill guards 20/20.
Both typechecks unchanged from baseline. Not run, per the owner: live provider request, app build,
Electron E2E.
