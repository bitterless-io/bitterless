---
id: eyes-on-agents-search-modal-067-1
target: working-tree-2026-08-26-dev-next
compared_with: eyes-on-agents-search-modal-067
---

# Verdict

**PASS. No P1, P2, or P3 finding remains.** The implementation satisfies the separate full-card
search-modal contract. Ral retains the real Electron visual and end-to-end check.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

The first independent pass found one asynchronous focus race: after Enter opened the provider app,
the completed promise tried to focus the search input again. That post-open focus call was removed,
a source guard now rejects its return, and the second independent pass returned PASS.

# Evidence

1. `AgentBoard` always passes `focusThreads`, while the Focus header renders only one Search button.
   The former persistent input, title-filter empty state, visible **Read all**, and renderer bulk-read
   action are absent. Main, preload, shared types, repository code, and their tests retain bulk-read
   support unmodified.

2. `App` mounts one `ThreadSearch` and routes `Cmd+F` / `Ctrl+F` through `toggleThreadSearch()`.
   Store close resets visibility, draft, committed query, and selection. Escape, modal Close, and
   mask cancellation use that same path.

3. The modal is contained by `.eyes-on-agents__main`, keeps its input fixed above a scrolling list,
   and directly renders `ThreadCard` for every match. No provider/title/status/card markup is
   duplicated. A restrained theme-blue surface and ring are the only selected-result treatment.

4. Empty and separator-only queries return no cards. Meaningful queries retain the existing
   NFKC/lowercase/title-token matcher. Selection is provider-qualified `sessionKey`, survives a
   matching snapshot, falls back when removed, and wraps in both directions.

5. Arrow and Enter synchronously commit the newest draft before resolving results. Enter uses the
   existing guarded `openThread(sessionKey)` path and never closes the modal. The renderer does not
   refocus after the asynchronous provider Open, so Codex or Claude keeps the foreground.

# Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents` | PASS, including 71/71 UI assertions |
| `yarn test:eyes-on-agents:ui` after final focus-race repair | PASS, 71/71 |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn typecheck:node` | PASS |
| `yarn build` | PASS |
| scoped `git diff --check` | PASS |
| independent source re-review after repair | PASS |
| `yarn check:renderer-i18n` | BLOCKED by pre-existing unrelated `Tray must follow Home creation` source-shape assertion; the changed EN/ZH catalogs pass Vue typecheck and build |
| Electron E2E | Not run — owner boundary |

# Owner Runtime Boundary

Ral should verify in the real app that Search opens at the intended size, the selected ring reads
correctly in both standalone and Omni placement, Up/Down scroll through long result sets, Enter
opens the intended Codex/Claude task without stealing focus back, and `Cmd+F` closes the modal.
