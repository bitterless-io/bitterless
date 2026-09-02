---
id: eyes-on-agents-search-shortcut-focus-reset-072-1
target: working-tree-2026-09-01-dev-next
compared_with: eyes-on-agents-search-shortcut-focus-reset-072
---

# Verdict

**PASS. No P1, P2, or P3 finding.** Shortcut/button opening reliably focuses the actual Search
input, and all close lifecycles reset transient search state without stale focus or query revival.

# Evidence

1. Reactive Search visibility and Arco Modal open both call the same `focusInput(revision)` path.
   After `nextTick`, the path requires both an open modal and the same lifecycle revision before it
   focuses the real Arco Input.
2. `closeThreadSearch()` increments the lifecycle and clears `titleDraft`, `titleQuery`, and the
   selected provider-qualified session key. Shortcut toggle, Escape, Modal cancel/mask, and
   successful result Open all reach that method.
3. The throttled title-query scheduler records the Search lifecycle revision with each invocation.
   A trailing callback from a closed or superseded lifecycle returns before publishing.
4. Failed, unavailable, and already-opening provider actions do not reach the close branch, so the
   owner keeps the current query and selection for retry.
5. Vue component events still use receiver-safe wrappers; the scheduler delegates through an arrow
   callback, so the class-based reactive store does not lose its receiver.

# Verification

| Check | Result |
|---|---|
| focused store coverage | PASS, 21/21 |
| mounted Search interaction | PASS, 4/4 |
| focused Search source coverage | PASS |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `git diff --check` | PASS |
| complete UI source suite | 25/26; one unrelated notification App ID assertion mismatch |
| independent implementation review | PASS, no finding |
| Electron E2E | Not run — owner boundary |

# Owner Runtime Boundary

Ral should open Search with `Cmd+F`, type immediately, close it with the shortcut, reopen it, and
confirm the input is empty and focused. Repeat with Escape and mask Close, then open one provider
result and confirm the destination app keeps focus while the next Search starts empty.
