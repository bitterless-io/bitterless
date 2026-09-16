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

**The wait declares an intent; it never blocks.** A blocking host tool was ruled out on mechanism, not
taste: the agent's `abort()` awaits every in-flight tool promise, so Stop could never end a blocking
wait; and a user's follow-up only reaches the model when steering drains at a tool boundary, so it
would hang with no bubble and no error. Chat tools receive no AbortSignal either. So:

- `workflow_wait` records which runs this chat is waiting for and **returns at once**. The Agent then
  ends its turn normally, so Stop works and the next user message works.
- **The wait is shown in the status bar, not asserted in a message.** The row reads "waiting for N
  workflows to finish" and is rendered from the host's own registry. That matters twice over: an
  Agent cannot tell the user it will wait without actually registering one, and the indicator cannot
  outlive a wait that has already fired or been cancelled. The Agent's closing reply says what it
  will do afterwards; it does not have to remember to announce the count.
- The declared wait **outranks** the plain background-Agent line, being the more specific fact; the
  Agent count and elapsed time move to that row's meta.
- When every named run settles, the host starts **one fresh turn in the same chat**. It fires once —
  the intent is consumed as it fires, so a repeated snapshot cannot continue the chat twice.
- **The continuation root is host-authored, never the user speaking.** It is flagged as such end to
  end so no surface renders it as a message the user typed, on first paint or on any later reload.
- **The continuation prompt is a pointer, not a restatement.** Each run's full outcome already reached
  the chat's background context when it settled; repeating it would show the model the same result
  twice. The prompt names each run's outcome — finished, finished with N failed Agents, failed, or
  stopped — so a failed branch can never pass for a finished one.
- **The user outranks the wait.** A new user message cancels it; the runs keep going and still deliver
  normally. If the chat is busy when the runs settle, no turn is forced — the outcome reaches the
  user's own next turn through the existing background context, exactly as before.
- Waiting on work that has already finished, on a run from another chat, or on nothing at all is
  refused with a reason rather than accepted into a wait that could never fire.
- **The tool never promises more than its host can do.** Declaring a wait, and showing it, works in
  both apps. Whether the host then starts the continuation turn itself is a property of the host, and
  the receipt carries it: where it can, the Agent is told to say it will pick the work up itself;
  where it cannot, the Agent is told explicitly not to claim that, and that the outcomes will simply
  be in its context when the user speaks next. Bitterless resumes today; see the task doc for what
  Cowork needs before it can.

## 4 · Planning a workflow

- Planning **reuses Kimchi's own authoring contract** rather than inventing prompts: its plan schema
  (goal, summary, acceptance criteria, decisions, steps with what each receives, produces and
  delivers), its plan renderer, and its design instructions.
- That contract is **reproduced, not imported**. `workflowPlanSchema`, `renderWorkflowPlan` and
  `designPrompt` live in Kimchi's `host/builtin/` and are **not in its public exports map** — only
  the whole `createWorkflowWorkflow` is, and that workflow is built from interactive and
  questionnaire steps this host rejects. Borrowing three symbols out of a private module would bind
  the planner to one patch release's internal file layout, so the schema descriptions and prompt text
  are copied verbatim from the pinned version and kept in sync by hand.
- The desktop host **rejects interactive and questionnaire steps**, so Kimchi's interview cannot run
  here. The planner is a **non-interactive variant**: one pass, one plan, rendered into the chat,
  confirmed in conversation.
- Losing the interview is handled in the open, not hidden. Every choice a question would have settled
  becomes an entry in **inferred decisions** naming what was assumed, and the question itself becomes
  an **open question** the user is asked to correct. The rendered plan has no "confirmed decisions"
  heading, because without an interviewer nothing in it was confirmed.
- A plan is a proposal, never an execution. The planner declares read-only tools, writes no file, and
  creates nothing; the rendered proposal says so explicitly.
- A design Agent that is stopped or fails yields an error, not an empty proposal.

## Verification

Shared counting, workflow grouping and ordering, header aggregation, collapse behavior, the wait
tool's suspend/continue/cancel paths, and the planner's schema reuse are covered by targeted tests in
both apps. No Electron E2E and no live model call are part of that verification.
