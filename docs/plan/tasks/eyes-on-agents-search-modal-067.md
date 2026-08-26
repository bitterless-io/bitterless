---
id: eyes-on-agents-search-modal-067
scope: replace the permanent Focus filter and Read all action with one keyboard-first card-result search modal
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-search-clear-064, eyes-on-agents-unknown-dot-session-path-066]
---

# EyesOnAgents Search Modal

## Objective

Make search a temporary task-finding workflow instead of permanent board chrome:

- remove the always-visible title input and **Read all** from the Focus header;
- leave one compact Search button;
- open a modal whose results reuse the complete normal thread card;
- support selected-result state, wrapping Up/Down navigation, and Enter to open;
- make `Cmd+F` on macOS and `Ctrl+F` on Windows toggle the modal closed as well as open it.

## Context

- [Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [Global title search](../../issues/eyes-on-agents-global-title-search.md)
- Tasks 055, 062, and 064 intentionally consolidated search into the Focus header. This task
  supersedes only that visible surface: token matching stays, while the board and search results
  become separate views again.

## Visual contract

```text
Focus board
┌────────────────────────────────────────────────────────────┐
│                                                        [⌕] │
│ ┌ normal ThreadCard ──────────────────────────────────────┐ │
│ └─────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘

Search modal
┌ Search threads ─────────────────────────────────────────────┐
│ [⌕ Search thread titles...                              ×] │
│ ╔ selected normal ThreadCard ═════════════════════════════╗ │
│ ╚═════════════════════════════════════════════════════════╝ │
│ ┌ normal ThreadCard ──────────────────────────────────────┐ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

The selected result uses one restrained blue surface/ring. Result content is not reimplemented:
provider icon, title, runtime/loading state, unread state, latest question, time, folder, Open, and
overflow actions all come from the existing `ThreadCard`.

## Required behavior

### Focus header

- The Focus list always renders the complete `focusThreads` projection and is never narrowed by
  the search query.
- Its header has one right-aligned, icon-only Search button with an accessible label and the
  platform shortcut in its tooltip.
- The permanent title input and visible **Read all** action are removed. Main/preload persistence
  support for bulk read acknowledgement remains available but is not exposed by this renderer.

### Modal lifecycle

- The Search button and `Cmd+F` / `Ctrl+F` open the same modal and focus its input.
- Pressing that shortcut while the modal is open closes it. Escape, Close, and the mask also close
  it.
- Closing clears the renderer-only query and selected session key. Reopening starts clean.
- The popup is contained by `.eyes-on-agents__main`, not the entire Omni surface.
- The input remains fixed above a separately scrolling result region. The modal is responsive,
  bounded by the current viewport, and does not make the board scroll.

### Matching and results

- Empty, cleared, and separator-only queries show a quiet start-typing state and no cards.
- Meaningful queries keep the existing title-only matching: Unicode NFKC, locale-aware lowercase,
  separators normalized to tokens, all query tokens required, order-independent partial-token
  matching.
- ID, cwd, Project, Domain, latest question, response, and raw snapshots remain excluded.
- Every result directly renders the existing normal `ThreadCard`; there is no reduced search-row
  representation and no duplicate card content implementation.

### Selection and opening

- The first current result is selected automatically.
- Selection identity is the provider-qualified `sessionKey`. A snapshot or query update preserves
  it when the result still exists, otherwise selection falls back to the first result.
- A single click selects a result. Mouse selection does not steal keyboard focus from the input.
- Up/Down wrap through the current results and scroll the selected card into view.
- Arrow and Enter handling synchronously commits the latest input draft before resolving results,
  so the existing throttled search cannot navigate or open a stale match.
- Enter opens the selected task through the existing `openThread(sessionKey)` path. The modal,
  query, and selection remain available after Open; the owner closes them explicitly with the
  shortcut, Escape, Close, or the mask.
- Existing card Open/menu behavior remains intact. No Main, XPC, SQLite, App Server, polling, or
  provider-open contract changes are introduced.

## Expected paths

- `docs/INDEX.md`
- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/issues/eyes-on-agents-global-title-search.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.less`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/focus-board-store.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- focused search interaction coverage and the EyesOnAgents test aggregate

## Verification

- Focused store/source/interaction checks cover query gating, selection reconciliation, wrapping
  navigation, latest-draft flushing, Enter Open, shortcut toggle-close, and real-card reuse.
- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents`
- `yarn check:renderer-i18n`
- `yarn build`
- Electron E2E is not run; Ral performs the end-to-end and visual check.

## Result

Implemented. Focus now always renders the complete `focusThreads` list and its header contains one
Search action. The contained modal reuses `ThreadCard`, owns renderer-only query and selected
`sessionKey` state, wraps Up/Down, flushes the latest throttled draft before Arrow/Enter, and keeps
the modal available after the established provider Open path. Closing through the shortcut,
Escape, Close, mask, or unmount clears every transient value.

An independent review found and then verified the repair of one asynchronous focus race: provider
Open no longer focuses the search input after its promise resolves, so the opened Codex or Claude
app keeps focus. [Review 1](../reviews/eyes-on-agents-search-modal-067-1.md) passes.

Non-Electron verification passed: the complete EyesOnAgents suite, 71/71 focused UI assertions,
EyesOnAgents UI and Node typechecks, build, and scoped whitespace checks. The renderer-i18n
aggregate is blocked by an unrelated existing `Tray must follow Home creation` source-shape
assertion; the changed EN/ZH structure is covered by the passing Vue typecheck and build. Electron
E2E was not run; Ral owns the visual/runtime check.
