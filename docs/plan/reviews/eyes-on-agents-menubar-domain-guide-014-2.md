# EyesOnAgents Menubar Domain And Hook Guide Review — Round 2

Status: accepted

Date: 2026-07-21

## Findings

No open P1, P2, or P3 finding remains.

The temporary **P3 · non-blocking** review-history finding is closed. The task now accurately records
Round 1's layout P2 and source-guard P3, followed by their Round 2 closure
(`docs/plan/tasks/eyes-on-agents-menubar-domain-guide-014.md:112-118`).

Round 1's **P2 · blocking** layout-contract finding is closed. The obsolete final inline Add Domain
column paragraph is gone. The current layout consistently makes the labelled menubar control and its
anchored form the only creation surface, explicitly says Domain creation does not occupy a board
column, and shows no Add Domain footer/component under `AgentBoard`
(`docs/integrations/eyes-on-agents-layout.md:28,89-90,137-140,170-172,245,275-284`). This now agrees
with the footer-free board source
(`src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue:3-38`).

Round 1's **P3 · non-blocking** source-guard finding is also closed. The guard now captures the Hook
guide's opening tag and rejects any `v-if` or `v-show`
(`scripts/eyes-on-agents/ui-source.test.mjs:516-520`). It separately binds
`showReviewGuidance` to the exact `needs_trust || error` predicate
(`scripts/eyes-on-agents/ui-source.test.mjs:535-543`). Those guards match the current unconditional
guide and conditional live summary
(`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue:112-147,249-251`).

## Conclusion

**Pass.** Both actual Round 1 findings and the temporary review-history finding are closed. Task 014
meets its static acceptance contract and is ready for Ral's visual interaction check.

## Static contract assessment

- Add Domain is the first labelled menubar action and remains available when the loading/empty board
  branch is shown. Its controlled anchored Trigger focuses on open and resets on Escape, Cancel,
  outside dismissal, or successful creation; a failed store action retains the form.
- The form trims its value, requires non-empty input, rejects case-insensitive duplicates and reserved
  `All`, and calls the existing store action. Both trigger and Create disable for every global busy
  action, submit rechecks busy state, and loading remains specific to `domain-create`.
- The old footer, `AddDomainColumn` files, and `add-domain-column` selectors are absent. Focus and All
  remain fixed header projections; the existing custom-only draggable indexes and reorder call are
  unchanged.
- The popup uses mini controls, accessible labels and error semantics, visible keyboard focus,
  shallow BEM, `oklch()` colors, and no decorative permanent border or shadow.
- The connection drawer renders one neutral, non-live, three-step ordered Hook guide in all five
  bridge states. Only the `needs_trust`/`error` reason summary is amber and live. English and Chinese
  copy preserve the exact Enable/Repair, conditional Review, `/hooks`, Check again/Check status, and
  Codex-only trust instructions.
- The existing Enable, Repair, Review, Check, and Disable state matrix and handlers remain intact.
  No trust RPC/hash write or automatic Trust path was added; Review may only re-enable fresh exact
  disabled definitions before leaving trust approval to Codex.
- The metadata-only observation boundary remains unchanged: no prompt/response delivery, App Server
  content read, or completion-driven read receipt was introduced.

## Verification

Per owner instruction, this review ran no tests, build, formatter, typecheck, or Electron process.
The assessment used only the current task/context documents, source, source guards, Round 1 review,
and `git diff`. Only this Round 2 review document was changed by the reviewer.
