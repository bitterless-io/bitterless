---
id: eyes-on-agents-search-close-after-open-070-1
target: working-tree-2026-08-31-dev-next
compared_with: eyes-on-agents-search-close-after-open-070
---

# Verdict

**PASS. No P1, P2, or P3 finding.** Successful Search-result Open closes the matching Search
lifecycle, while failed, guarded, and stale asynchronous attempts preserve the owner's current
Search state.

# Evidence

1. Enter delegates through `openSelectedThreadSearchResult()` to the shared `openThread()` action.
2. `ThreadCard` keyboard Open, double-click, and menu Open also delegate to that same action, so the
   success lifecycle is consistent across every Search-result affordance.
3. `openThread()` closes Search only after the provider emitter resolves and its snapshot applies.
   Provider rejection, unavailable Claude routing, and the already-opening guard cannot reach the
   close branch.
4. The captured lifecycle revision must still match when Open resolves. Closing and reopening
   Search increments that revision, so an old request cannot close the new modal.
5. When Search is not visible, `openThread()` captures no Search lifecycle and a normal Focus-card
   Open leaves Search state alone.
6. Arco Modal's close path does not restore focus, and the post-Open component path does not refocus
   the Search input, so the source contains no route that steals focus back from Codex or Claude.

# Verification

| Check | Result |
|---|---|
| `node --test scripts/eyes-on-agents/focus-board-store.test.mjs` | PASS, 19/19 |
| `yarn test:eyes-on-agents:ui` | PASS, 75/75 |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| scoped `git diff --check` | PASS |
| independent code/test review | PASS, no finding |
| Electron E2E | Not run — owner boundary |

# Owner Runtime Boundary

Ral should open Search in the development app, open one result with Enter and one by card action,
and confirm Search closes while Codex or Claude retains foreground focus.
