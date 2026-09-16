---
status: in-progress
depends-on: []
verify: targeted workflow host and UI tests, strict workflow types, focused vue-tsc, i18n checks, behaviour guards; human Electron testing
---

# Workflow grouping, waiting, and planning

Implement [contract](../../features/workflow-grouping-and-wait.md) in this project on the existing
branch, mirrored with Micromeet Cowork. Owner approved the design prototype and chose: task bar in
two parts (counts in the trigger, exceptions stay in the summary slot), and a non-interactive
planner rather than adding a resume host.

## Parts

- [x] **Counts** — task bar label becomes `N workflows · M agents`, localized in every bundle, driven
      by the same shared fact computation the status row already uses so the two cannot disagree.
- [x] **Grouping** — roster groups by workflow first and status second; group header aggregates an
      attention state, carries elapsed time and a subtitle, collapses when the run has ended, and
      owns per-workflow stop and rerun.
- [x] **Wait (Bitterless)** — `workflow_wait` declares an intent and returns at once; the turn ends
      normally; when every named run settles the host claims a host-authored turn and continues in
      the same chat. Refuses waits that could never fire, fires once, yields to a busy chat.
- [x] **Wait — declaring and showing it (both apps)** — the status bar renders "waiting for N
      workflows to finish" from the host registry, so it cannot be claimed without being registered
      nor outlive a cancelled one. The user's own turn cancels the wait and clears the row.
- [ ] **Wait — Cowork resuming by itself** — the receipt already tells the Cowork agent not to claim
      it will, so nothing is currently dishonest; what is missing is the resume. Cowork's only proven
      path to start a turn is the renderer's `turnService.send()`, which appends a `role: 'human'`
      message the user never typed and which `recordUserChainMessage` persists into
      `chain/<sessionId>.jsonl` as 用户原话, where compaction feeds it back forever. A detached root
      message plus a host-authored flag on the send params looks sufficient — `humanMessage` is only
      used for token counting, the first-message title and `protectMessageIds` — but that cannot be
      confirmed without running the app, and `turn.service.ts`'s own guard,
      `check-behavior-turn-steering.mjs`, currently crashes before reaching its assertions, so the
      change would land with the net down. Fix the guard first, then wire it.
- [x] **Planner** — non-interactive workflow planning reusing Kimchi's plan schema, plan renderer and
      authoring guidance; renders a proposal into the chat and never executes it unprompted.

## Not in scope

Loading external workflow packages and listing them in Workbench is paused at the owner's request
until cloud distribution defines the package format.

Design prototype (mock data only):
`/Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/design/workflow-grouping.html`
