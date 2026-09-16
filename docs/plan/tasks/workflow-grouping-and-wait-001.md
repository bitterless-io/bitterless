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

- [ ] **Counts** — task bar label becomes `N workflows · M agents`, localized in every bundle, driven
      by the same shared fact computation the status row already uses so the two cannot disagree.
- [ ] **Grouping** — roster groups by workflow first and status second; group header aggregates an
      attention state, carries elapsed time and a subtitle, collapses when the run has ended, and
      owns per-workflow stop and rerun.
- [ ] **Wait** — a host chat tool that suspends the turn until named runs settle, states what it is
      waiting for before suspending, continues in the same session with real outcomes, reports
      missing branches honestly, and yields to a new user message.
- [ ] **Planner** — non-interactive workflow planning reusing Kimchi's plan schema, plan renderer and
      authoring guidance; renders a proposal into the chat and never executes it unprompted.

## Not in scope

Loading external workflow packages and listing them in Workbench is paused at the owner's request
until cloud distribution defines the package format.

Design prototype (mock data only):
`/Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/design/workflow-grouping.html`
