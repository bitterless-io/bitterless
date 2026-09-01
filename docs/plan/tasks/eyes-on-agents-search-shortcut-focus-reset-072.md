---
id: eyes-on-agents-search-shortcut-focus-reset-072
scope: deterministic Search input focus on shortcut open and complete transient reset on close
status: implemented; owner verification pending
depends-on: [eyes-on-agents-search-close-after-open-070]
---

# EyesOnAgents Search Shortcut Focus and Reset

## Objective

Make the `Cmd+F` / `Ctrl+F` Search flow immediately typeable and ensure every close path returns
the next Search session to a clean state.

## Required behavior

- Opening Search from the global shortcut focuses the real input after the modal has entered and
  the input is mounted. The visible Search button follows the same focus path.
- Repeating `Cmd+F` / `Ctrl+F` while Search is open closes it and clears the visible input draft,
  committed query, selected session, and pending throttled publication.
- Escape, modal Close, mask Close, and successful result Open use the same reset contract.
- A delayed focus callback from a closing or superseded modal lifecycle cannot steal focus from
  Codex, Claude, or the Bitterless board.
- A delayed throttled query callback from a closed lifecycle cannot restore cleared text or
  results.
- Existing keyboard result navigation, provider Open behavior, and failure-preserves-search
  behavior remain unchanged.

## Expected paths

- `docs/issues/eyes-on-agents-global-title-search.md`
- `docs/features/eyes-on-agents-focus-board.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- focused EyesOnAgents store, source, and mounted interaction coverage

## Verification

- Mounted coverage proves shortcut-equivalent open focuses the real Arco input.
- Store/component coverage proves shortcut, Escape, modal cancel, and successful Open clear all
  transient search state.
- Coverage proves stale focus and throttled callbacks cannot affect a closed/reopened lifecycle.
- `yarn test:eyes-on-agents:ui`
- `yarn typecheck:eyes-on-agents:ui`
- `git diff --check`
- Electron E2E is not run; Ral performs the real-app shortcut and focus check.

## Result

Implemented. Search now focuses the real Arco input through one lifecycle-guarded path used by
both reactive visibility and the Modal open event. Closing or superseding that lifecycle makes an
older delayed focus callback inert.

The title-query scheduler now carries the lifecycle revision that scheduled it. A trailing callback
from a closed or replaced Search cannot publish into the current modal. Shortcut close, Escape,
Modal cancel/mask, and successful result Open all reuse `closeThreadSearch()`, which clears the
visible draft, committed query, and selection; unsuccessful Open still preserves them.

[Independent review 1](../reviews/eyes-on-agents-search-shortcut-focus-reset-072-1.md) passed with
no P1, P2, or P3 finding. Store, mounted Search, focused source, UI typecheck, and whitespace checks
passed. The complete UI source suite retains one unrelated notification App ID assertion mismatch
against the dirty worktree's existing `runtimeProfile` implementation. Electron E2E was not run;
Ral owns the real-app shortcut/focus verification.
