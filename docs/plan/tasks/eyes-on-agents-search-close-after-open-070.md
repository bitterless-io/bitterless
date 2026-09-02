---
id: eyes-on-agents-search-close-after-open-070
scope: close EyesOnAgents Search after a selected task opens successfully
status: implemented; owner verification pending
depends-on: [eyes-on-agents-search-receiver-safety-069]
---

# EyesOnAgents Search Close After Open

## Objective

Finish the temporary-search workflow by dismissing Search as soon as the selected Codex or Claude
task has opened successfully.

## Required behavior

- Enter opens the selected result through the established provider path, then closes Search and
  clears its renderer-only query and selection after success.
- Double-click and the card-menu Open action have the same close-after-success behavior when the
  normal `ThreadCard` is rendered inside Search.
- The same `ThreadCard` on the Focus board keeps its existing behavior; opening from the board does
  not manipulate Search.
- An unavailable, already-opening, or failed provider Open does not close Search or clear its
  query/selection, so the owner can retry or choose another result.
- Closing Search after provider Open must not restore focus to Bitterless or refocus the search
  input after Codex or Claude receives focus.
- Existing read acknowledgement, provider route validation, snapshot application, and action-error
  behavior remain unchanged.

## Expected paths

- `docs/issues/eyes-on-agents-global-title-search.md`
- `docs/features/eyes-on-agents-focus-board.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- focused EyesOnAgents store and mounted interaction coverage

## Verification

- Enter closes and resets Search only after a successful Open.
- A Search result's double-click and menu Open close Search only after success.
- Failed and guarded Open attempts preserve Search state.
- Focus-board card Open remains independent from Search.
- `yarn test:eyes-on-agents:ui`
- `yarn typecheck:eyes-on-agents:ui`
- `git diff --check`
- Electron E2E is not run; Ral performs the real-app check.

## Result

Implemented. The shared `openThread(sessionKey)` action captures the current Search lifecycle and
closes Search only after the provider Open succeeds in that same lifecycle. Closing clears the
renderer-only draft, query, and selection. Provider rejection, unavailable Claude routing, and an
already-opening guard leave Search unchanged. A lifecycle revision prevents an older pending Open
from closing a Search modal that the owner closed and reopened in the meantime. Opening a normal
Focus card while Search is not visible remains independent of Search.

[Independent review 1](../reviews/eyes-on-agents-search-close-after-open-070-1.md) passed with no
finding. The focused store suite passed 19/19, the EyesOnAgents UI suite passed 75/75, UI typecheck
passed, and scoped whitespace validation passed. Electron E2E was not run; Ral owns the real-app
focus and provider-opening verification.
