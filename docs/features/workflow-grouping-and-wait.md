# Workflow grouping, waiting, and planning

Contract for the chat-side workflow experience once more than one workflow can be in flight at
once. Mirrored byte-for-byte into `micromeet-cowork/docs/features/workflow-grouping-and-wait.md`;
a change to one is a change to both.

Supersedes one rule from [background workflow tasks](./background-workflow-tasks.md): the task bar
used to count Agents only, explicitly "not by workflow container". It now counts both.

Design prototype (owner-facing, mock data only):
`/Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/design/workflow-grouping.html`

## Why

Concurrent workflows already run — a background workflow deliberately does not reserve a chat turn.
What was missing is that the UI never said which Agent belonged to which workflow. With two
workflows live, `code-review`'s "logic bugs" Agent and `research`'s "search" Agent sat side by side
under one flat "in progress" heading. The user could not tell them apart, and stopping the wrong one
looked identical to stopping the right one.

## 1 · The task bar counts both

- The bar label is **`N workflows · M agents`**, localized. `N` counts live workflow runs in this
  chat; `M` counts active Agents across them. Both use the same shared fact computation as the
  status row, so the bar and the status row can never disagree.
- Only live runs count. A run that completed, failed or stopped contributes zero, and a paused Agent
  is not active — the existing definitions do not change.
- Zero live workflows means the whole bar is absent and reserves no height. Unchanged.
- The summary slot beside the label keeps carrying exceptions — *N waiting for your confirmation*,
  *N failed* — so the counts must not be merged into that slot.

## 2 · The roster groups by workflow

- **First level is the workflow**, newest run first. Each group header carries the workflow name, an
  aggregate state, elapsed time, and a one-line subtitle: what it is doing, or what is blocking it.
- **Second level is its Agents**, ordered so that whatever asks for the user rises: awaiting
  confirmation → running → queued → paused → completed → failed → stopped. Status stops being a
  top-level heading; it stays visible on every row.
- An attention state is **promoted to the group header**: if any Agent awaits confirmation, or any
  failed, the header says so. Finding a blocked Agent must not require expanding every group.
- **Ended workflows collapse by default**, showing one header line and an outcome summary. Expanding
  restores the full Agent list with logs and results — no record is dropped.
- Stopping now has three scopes, all explicit: *stop everything in this chat* (unchanged, top of the
  popover), *stop this workflow* (new, on the group header), *stop this Agent* (unchanged, on the
  row). Rerun stays a per-workflow action and moves to the group header.
- Per-Agent pause, resume and steering stay exactly where they are.

## 3 · The main chat can wait

Today a finished run is delivered into the chat and into the main Agent's background context, but the
main Agent never waits — it ends its turn, and the user must prompt again before the result is used.

- A host tool lets the main Agent **wait for named runs in this chat** and continue in the same
  session once they settle.
- The Agent **must say what it is waiting for before it suspends**. A silent stall is a failure, not
  a feature: the user has to be able to tell waiting apart from hanging.
- Settling includes failure and being stopped. On continuation the Agent reports which branches are
  missing rather than presenting a partial result as complete.
- **The user outranks the wait.** A new user message cancels it and is answered immediately; the runs
  keep going and still deliver normally.
- Waiting is bounded and cancellable, and it never blocks another workflow, another chat, or the
  broadcast.

## 4 · Planning a workflow

- Planning **reuses Kimchi's own authoring contract** rather than inventing prompts: its plan schema
  (goal, summary, acceptance criteria, decisions, steps with what each receives, produces and
  delivers), its plan renderer, and its authoring reference.
- The desktop host **rejects interactive and questionnaire steps**, so the interactive interview in
  Kimchi's own `create.workflow` cannot run here. The planner is therefore a **non-interactive
  variant**: it produces one plan in a single pass, renders it into the chat, and the user confirms
  in conversation. The schema and prompt text are unchanged.
- What is lost relative to the interactive version — batched clarifying questions before the plan —
  is stated in the doc rather than hidden, and the plan says which decisions were inferred rather
  than confirmed.
- A plan is a proposal, never an execution. Nothing runs until the user accepts it.

## Verification

Shared counting, workflow grouping and ordering, header aggregation, collapse behavior, the wait
tool's suspend/continue/cancel paths, and the planner's schema reuse are covered by targeted tests in
both apps. No Electron E2E and no live model call are part of that verification.
