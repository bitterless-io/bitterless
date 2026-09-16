---
status: completed
depends-on: []
verify: focused workflow lifecycle, chat steering, renderer and type checks; human Electron testing
---

# Background workflow task control

Implement [contract](../../features/background-workflow-tasks.md) in this project on the existing branch. Complete code-level verification; no independent review or Electron E2E.

Code implementation and focused verification completed. Human testing remains the owner handoff; see the feature verification notes.

## Status bar and completion visibility (2026-09-16)

- [x] Background-Agent status row that survives a settled turn, with localized counts.
- [x] One-sentence model summary of the work in progress, degrading to counts on any failure.
- [x] Localized, deduplicated completion message in the conversation.
- [x] Targeted tests, strict workflow types, focused UI types, i18n checks and isolated bundles.
- [x] Sentence follows the Agent set, not the tool step: refreshed in place, blanked only when the Agents change.
- [x] Bounded retry budget for an unusable model (3 consecutive attempts), restored when the Agents change.
- [x] The view reads `workflowActivityFacts` from its presentation layer, keeping the Maestro alias boundary at its existing 13 violations.


Contract: [background workflow tasks](../../features/background-workflow-tasks.md).
Human acceptance: `/Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/status-bar-and-completion-testing.md`.
Evidence: `/Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/verification/status-bar-and-completion/README.md`.
