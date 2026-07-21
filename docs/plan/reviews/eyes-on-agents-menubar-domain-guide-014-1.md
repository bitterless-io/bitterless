# EyesOnAgents Menubar Domain And Hook Guide Review — Round 1

Status: blocked

Date: 2026-07-21

## Findings

### P2 · blocking — The layout contract still specifies the removed Add Domain column

Task 014 requires the board footer and `AddDomainColumn` to be removed so the draggable board contains
only Focus, All, and custom Domain columns
(`docs/plan/tasks/eyes-on-agents-menubar-domain-guide-014.md:36,50-52`). The updated layout also says
Domain creation is never rendered as a board column
(`docs/integrations/eyes-on-agents-layout.md:137-140`), and the source follows that rule
(`src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue:3-38`).

However, the same current layout still specifies a final narrow add column with inline validation,
Escape, and Enter behavior (`docs/integrations/eyes-on-agents-layout.md:170-173`). That is the deleted
`AddDomainColumn` contract, so the task's source-of-truth layout now gives mutually exclusive guidance
for the same interaction. Remove or rewrite the obsolete paragraph before task 014 is considered
delivered.

### P3 · non-blocking — The Hook visibility guards do not enforce their exact predicates

The task requires the guide to remain unconditional in all five bridge states and the live summary to
remain limited to `needs_trust` and `error`
(`docs/plan/tasks/eyes-on-agents-menubar-domain-guide-014.md:69-77,105-106`). The implementation is
correct: the guide has no state gate, and `showReviewGuidance` uses exactly those two states
(`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue:112-147,249-251`).

The source guard's state expression at
`scripts/eyes-on-agents/ui-source.test.mjs:479-482` is unscoped and can be satisfied by
`canReviewBridge`; it does not bind the expression to `showReviewGuidance`. The guide check at
`scripts/eyes-on-agents/ui-source.test.mjs:516-535` prohibits only `v-if="showReviewGuidance"`, so a
different state gate on the guide would also pass. Assert the exact summary predicate and prohibit any
conditional on the guide's opening element so the guards actually preserve the documented contract.

## Conclusion

**Blocked.** The current Vue/LESS implementation meets task 014, including the repaired global-busy
creation lifecycle, but the current layout document still defines the removed board-column workflow.
The source-guard precision issue is non-blocking.

## Static contract assessment

- `AddDomainPopover` is always reachable from the menubar, including the empty board state. Its
  controlled Trigger resets on outside dismissal, Escape, Cancel, and success; opening focuses the
  input; store rejection retains the form and title.
- Trimmed required, case-insensitive duplicate, and reserved `All` validation call the existing
  `createDomain` store action. Both trigger and Create are disabled for any global `busyAction`, the
  submit path rechecks busy state, and only `domain-create` shows loading, so another action cannot
  cause a no-op creation followed by form closure.
- The board footer, old component files, and `add-domain-column` selectors are removed. Focus and All
  remain fixed header projections, while `oldDraggableIndex`/`newDraggableIndex` continue to address
  only custom Domains.
- The popup uses mini controls, labelled dialog/input/error semantics, visible focus, shallow BEM,
  `oklch()` colors, and no decorative permanent border or shadow.
- The Hook guide is unconditional, neutral, non-live, ordered, and bilingual. Only the
  `needs_trust`/`error` summary is amber and live. The fixed copy accurately distinguishes Enable,
  Repair, conditional Review, `/hooks`, Check again, and Check status.
- Review, Check, and Disable visibility and handlers are unchanged. No renderer trust RPC or trust
  hash write was added; the existing review path only re-enables fresh exact disabled definitions and
  leaves trust to Codex.

## Verification

Per owner instruction, this review ran no tests, build, formatter, typecheck, or Electron process.
The assessment used only task/context documents, current source, source guards, and `git diff`. Only
this review document was changed by the reviewer.
