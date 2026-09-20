# The workflow catalog belongs in the prompt, not behind a tool call

Date: 2026-09-20. Status: implemented in both apps, code-verified; owner verification pending.
Owner request (Ral 2026-09-20): 「按你建议的顺序做，另外看起来 自然语言发起 workflow 有缺陷
按你建议的顺序调整，bl cowork 要统一 entry」— the order being ④ description contract → ① prompt
preload → ⑤ entry unification.

Builds on [`local-workflow-directory.md`](local-workflow-directory.md), which made the library a
folder on this machine. That feature is about the **owner** seeing the list. This one is about the
**model** seeing it.

Paired with micromeet-cowork — common functionality, same change in both repos.

## The defect

A workflow can only be started from natural language if the model knows a workflow exists. Today it
does not: the catalog is reachable only by calling `workflow_list`.

Meanwhile the **skills** in the same prompt are preloaded — `formatSkillsForPrompt()`
(`src/main/agent/runtime/agentPrompt.ts`), the Agent Skills XML standard, name + description
resident, body read on demand. So one process runs two different disclosure models:

| | how the model learns it exists | cost of learning |
| --- | --- | --- |
| skills | resident in the system prompt | paid once per turn, bounded |
| workflows | `workflow_list` tool call | a whole turn, and only if it guesses to look |

"Only if it guesses to look" is the actual failure. Asked to do something a workflow handles, the
model does the work itself — it has no signal that a better route exists. That is not a prompt
problem to be fixed with a sentence telling it to call `workflow_list`; a sentence competes with
74k characters of other reference material, whereas a resident catalog **is** the signal.

## ④ A one-line description cannot carry a routing decision

`workflow.json` has `description`, and nothing says what it is for. Pi's skill descriptions carry
**what it does + when to use it**, because that is what the reader is deciding. Preloading 200 rows
of "this workflow does X" produces a catalog the model still cannot route with — it would make the
prompt longer without making the choice possible. So the contract changes before the preload does.

- **`whenToUse`** — optional, ≤ 2000 chars. The conditions under which this package is the right
  route: the inputs it expects, the situation it is for, and where it does not apply. `description`
  keeps its meaning (what it is); `whenToUse` answers the question actually being asked.
- **`modelInvocation`** — optional boolean, default `true`. `false` keeps the package out of the
  prompt and out of `workflow_list`; it stays runnable by explicit owner request. This mirrors Pi's
  `disable-model-invocation` frontmatter, inverted so the default is not a double negative. Without
  it, a folder of 200 packages has no way to stay out of every turn's context.

Neither field is required, and a package without them keeps working — an existing package must not
become invalid because a field was added. A package with no `whenToUse` is still listed and still
preloaded; it simply gives the model less to route on. `check-workflow-package.mjs` warns.

## ① Preload, budgeted, with the omissions named

- Rendered by `workflowCatalogPrompt()` and placed next to the existing skill catalog in
  `buildAgentTurnPrompt`, inside the same "reference material" fence.
- **Built from the last published snapshot, not a rescan.** The prompt is rebuilt on every turn and
  on every steer; re-parsing 200 manifests on each one would put a directory scan on the latency
  path of typing. The `fs.watch` already keeps the snapshot equal to the folder.
- **Therefore the first scan has to happen at boot.** Cowork already does this
  (`startWorkflowLibrary()`); Bitterless only ensured the root and left the first scan to whoever
  asked first, so before the Workbench was ever opened `items()` was empty — and a prompt built from
  it would silently claim there are no workflows. Bitterless gains the same boot prime.
- **Rows with `error` are excluded**, unlike the Workbench list. A broken package is something the
  owner must see and the model must not be told to run. The count of excluded rows is stated.
- **Byte budget of 8 KiB.** Beyond it, rows are dropped and the exact number is written into the
  block. A silently truncated catalog reads as "these are all the workflows", which is the one thing
  it must never read as.
- `workflow_list` stays. It is now the refresh path ("something changed since this prompt was
  built"), not the discovery path.

## ⑤ One `entry` shape across both apps

Today the same descriptor means two different things:

| | descriptor `entry` | resolved |
| --- | --- | --- |
| Bitterless | `{kind:'library', ref}` | at run time, re-reading the manifest |
| Cowork | `{kind:'file', path}` | at list time |

Cowork therefore runs the entry path as it was when the list was built. Between listing and running,
the owner can edit `workflow.json` to point at a different entry — Cowork runs the old one, with no
error, which is the failure shape this whole feature exists to avoid.

Unified on `{kind:'library', ref}`: the descriptor names the package, and the entry path is resolved
from the manifest at start. Cowork's `hostIntegration` gains the same resolve step Bitterless has,
and its loader keeps rejecting anything that is not a file path by the time it is called.

The lookup half goes the other way: Cowork's `workflow_run` resolves the name **through the
catalog** and fails with "not available in the current scope" when it is absent, while Bitterless
parses the reference string directly and only finds out at load. Bitterless adopts Cowork's lookup.
Each app keeps the safer half of what it already had.

## Verification

Scoped Node tests, no Electron E2E (workspace rule). Run 2026-09-20:

- `yarn test:workflow-library` — **27 pass / 0 fail**, of which 10 are the new
  `tests/workflowLibrary/catalogPrompt.test.mjs`: `whenToUse` / `modelInvocation` optional and
  absent-stays-absent (the canonical manifest round-trips byte-identically), `whenToUse` bounded at
  2000, `modelInvocation: "false"` **rejected** rather than coerced, a broken package excluded and
  counted, a withheld package excluded and counted, the byte budget proven by 400 packages
  (rendered + omitted === 400, and the omitted count is printed), an empty library rendering an
  explicit empty, and `</available_workflows>` in a description escaped so it cannot close the block.
- `yarn typecheck` — the files this change touches are clean. Two errors remain in the tree
  (`maestroAgent.service.ts` `SessionIoPathResult.error`, `hostIntegration.ts` `WorkflowWaitResult`);
  both predate this change and belong to concurrent work in the same checkout.
- End-to-end render against the real MCU package: scanner → renderer produced the catalog block with
  reference, name, description and `when_to_use`, angle brackets escaped.

Not verified by a test, because it is a boot-ordering change: `startWorkflowLibrary()` runs after
`ensureWorkflowsRoot()` in `app.main`. It is the same call Cowork already makes at the same moment.
