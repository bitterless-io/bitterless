# EyesOnAgents Focus-Only Board

Status: implemented; owner verification pending

Date: 2026-08-19

## Decision

The Domain board is retired from the EyesOnAgents UI. One `Focus` column becomes the whole board and
lists **every** visible thread instead of only attention items. Focus keeps all of its existing
behavior — comparator, unread semantics, and card affordances — while search lives in a temporary
keyboard-first modal whose results reuse those same cards.

The owner reported that Domains are unused. Removal is deliberately staged:

| layer | this delivery |
|---|---|
| renderer UI (`Add Domain`, custom Domain columns, `All` column, card `Move to Domain`, drag) | removed |
| renderer Project filter (Select, service, selection state) | removed |
| renderer store Domain actions and Domain projections | removed |
| Main/preload persistence, `eyes_on_agents_domain` table, `domain_id`, XPC Domain methods | **retained, unexposed** |

No SQLite migration, no `domain_id` change, and no XPC handler removal happen here. Every thread
keeps its stored Domain assignment, and the `uncategorized` system Domain remains the storage
fallback, so restoring or finishing the removal stays a local decision.

## Board layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  EyesOnAgents        ● Connected  [↻ Refresh] [Bridge] [Pin]                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │                                                                    [⌕] │ │
│ │ ┌──────────────────────────────────────────────────────────────────────┐ │ │
│ │ │ ◉ API pagination refactor                                    ◌       │ │ │
│ │ │ now                                                    [⌂][…]        │ │ │
│ │ ├──────────────────────────────────────────────────────────────────────┤ │ │
│ │ │ ◉ Fix migrations                                             ◌       │ │ │
│ │ │ 1m                                                     [⌂][…]        │ │ │
│ │ ├──────────────────────────────────────────────────────────────────────┤ │ │
│ │ │ ◉ Release notes                                              ●       │ │ │
│ │ │ 4m                                                     [⌂][…]        │ │ │
│ │ ├──────────────────────────────────────────────────────────────────────┤ │ │
│ │ │ ◉ Project notes                                                      │ │ │
│ │ │ 4h                                                     [⌂][…]        │ │ │
│ │ └──────────────────────────────────────────────────────────────────────┘ │ │
│ │                                                    list scrolls ↓        │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│   one column · fills the board width and height · window minimum 480 × 600    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The column fills the board's content box: no fixed width, no maximum width, no wrapping, because
  there is nothing to wrap against. It is the board.
- The column fills the available height from below the menu bar to the bottom board padding. The
  600px cap is removed; the thread list scrolls inside the column body, and the board itself no
  longer owns vertical scrolling.
- The standalone window minimum is **480 × 600** so the board works as a narrow side panel. That
  480px width is a deliberate exception to the project-wide 800px window floor, recorded in
  [task 056](../plan/tasks/eyes-on-agents-focus-full-width-056.md). The 1120 × 720 default is
  unchanged. At that width the menu-bar identity shrinks and ellipsizes so the connection, Refresh,
  bridge, and pin controls stay reachable.
- The column paints no surface and carries no padding: white cards sit straight on the board canvas.
  The 8px inset lives on the board region (`.eyes-on-agents__main`), and the column keeps an 8px gap
  between its header and the scrolling list. Window-activation tinting was retired with the surface
  it colored.
- Text actions and icon controls use `theme.ts` arcoblue-5 as ink and gain an arcoblue-2 surface on
  hover. The modal search field is a plain white input.

## Membership

| before | after |
|---|---|
| `Focus` = unread OR active (`working`, `waiting_approval`, `waiting_input`) | `Focus` = every visible thread |
| `All` = every visible thread | removed |
| custom Domain column × N | removed |

Focus membership is now the same visible-thread set that `All` used to render: non-archived,
non-tombstoned threads that pass the existing provider visibility rules, including the Claude
Desktop-route requirement. A thread never leaves the board because it was read, acknowledged, or
resolved — only provider visibility rules remove a row.

## Ordering

Focus keeps the stable timestamp semantics defined in
[EyesOnAgents working cards reorder during replies](../issues/eyes-on-agents-working-order-churn.md):

1. `waiting_approval`
2. `waiting_input`
3. visible unread dot (`is_unread` on `idle`, `failed`, `ended`, or `unknown`)
4. `working`
5. every other thread

Within an active rank (waiting or working), `status_observed_at` descending — the time the thread entered its
current working/waiting state. A reply, title, question, or `last_activity_at` refresh must not move
an active card; a missing or invalid value sorts as zero. Within the unread rank and the ordinary
rank, `last_activity_at ?? last_completed_at` descending. Every equal-rank/equal-time comparison
ends with provider-qualified session key ascending.

Waiting on the user remains highest, but a completed/unknown row whose red dot is visible now sits
ahead of `working`; the user can inspect finished attention before background work. A working row's
normally latent unread bit never moves it into the dot tier. The hot/cold SQLite refresh pages keep
activity order as a fetch-budget policy and still do not define presentation order.

## Focus header controls

The header has no `Focus` heading or persistent input. One right-aligned, icon-only Search button
opens the modal; its accessible label names Search and its tooltip discloses `⌘F` on macOS or
`Ctrl+F` on Windows.

| control | behavior |
|---|---|
| Search | opens a clean modal and focuses its input |

The visible **Read all** action is retired. Its Main/preload mutation remains retained and
unexposed; per-thread **Mark as read** / **Mark as unread** stays in each card menu.

## Search modal

Search is separate from the board. `Cmd+F` / `Ctrl+F` suppresses native page Find and toggles the
same modal as the header button:

| input | behavior |
|---|---|
| Search button or shortcut while closed | open a clean modal and focus the input |
| shortcut while open | close the modal and clear query/selection |
| `Escape`, Close, or mask | close the modal and clear query/selection |
| typing | search titles inside the modal; the Focus board remains complete |
| Up / Down | wrap through results and scroll the selected card into view |
| Enter | open the selected task through its existing provider path; close Search after success |
| double-click or card-menu Open | open that task; close Search after success |

The popup is contained by `.eyes-on-agents__main`. Its input stays fixed above a separately
scrolling result region, and the complete modal is bounded by the current viewport. An empty,
cleared, or separator-only query shows a quiet start-typing prompt and no cards.

Matching keeps the stronger token semantics delivered by
`eyes-on-agents-token-title-search-032` instead of the previous plain substring test:

- the query and each `thread.title` are normalized (`NFKC`), lowercased, and split on whitespace plus
  `-`, `_`, `.`, `/`, `\`, `:`, `|`;
- every query token must be contained in some title token, in any order, so `ops git` and
  `git ops` both match `ops-git`;
- an empty, whitespace-only, or separator-only query produces no modal results;
- only `thread.title` is matched — never thread ID, `cwd`, Project, prompt, or response content;
- a thread with no resolved title never matches a non-empty query.

Every result directly renders the normal `ThreadCard`, so provider, title, loader, unread dot,
latest question, time, folder, Open, overflow actions, and accessibility remain identical to the
board. The first result is selected; selection is retained by provider-qualified `sessionKey`, a
single click selects, and Up/Down wrap. Enter, double-click, and card-menu Open use the existing
`openThread` path. Search closes and clears its transient query/selection only after that path
succeeds; an unavailable, already-opening, or failed Open preserves the current Search state.

### Typing is decoupled from filtering

Two values back the modal. `titleDraft` is what the input shows and updates on every keystroke;
`titleQuery` is what the result list matches. A keystroke only writes the draft and asks a shared
`useThrottleFn(run, 120, true, true)` scheduler — leading plus trailing — to publish it.

The commit reads the **current** draft rather than a captured value. Arrow and Enter synchronously
commit that draft before resolving selection, so a pending throttle cannot navigate or open a stale
match. Closing resets draft and query together; without a configured scheduler the commit is
synchronous, which keeps tests and non-browser callers deterministic.

Each pass is also cheap: the sorted thread list is memoized by snapshot identity and each thread's
title tokens are memoized per thread object and re-tokenized only when that title changes. Both
caches live outside the reactive store, so filling them can never trigger a render.

## Project filter — retired

The Project Select is gone from this board: no component, no `projectFilter.service.ts`, and no
selection state, options, or reconciliation in the store. Main-side Project resolution and the three
`project_*` columns stay exactly as they are, on the same "retain the storage, drop the UI" footing
as Domains — see [EyesOnAgents Project filter](eyes-on-agents-project-filter.md).

The board has no narrowing control. Search results exist only inside the modal, while the Focus
empty state continues to mean there are no visible threads.

## Thread card

The card has one status slot and one menu:

- **Title-row status slot** — a fixed 16×18px box right of the title. It shows the working spinner
  while the row is active, and the unread red dot for any **non-active** unread row — terminal or
  `unknown`. Spinner and dot are mutually exclusive there, so the card never grows a second status
  region and an active row never shows the dot. Covering `unknown` is deliberate: such a row is
  promoted to the unread tier, so it must be able to explain its own position.
- **Card menu** — the `…` button is always present and remains the keyboard-accessible trigger.
  Right-clicking anywhere on the card opens the exact same menu at the pointer. The popup teleports
  to the renderer body so card/list overflow cannot clip it; Arco fits it inside the viewport,
  placing it mainly to the right of a left-edge pointer, mainly to the left of a right-edge pointer,
  and above the pointer when there is not enough room below. Opening either trigger closes the
  other popup, and scrolling closes a pointer-anchored menu.
  Menu contents are:
  1. **Open in Codex** / **Open in Claude** — named for the row's provider, with a quiet
     `(double click)` / `（双击）` hint, because double-click and `Enter` do the same thing. Omitted for
     a Claude row with no trusted Desktop route.
  2. **Mark as read** / **Mark as unread** — labelled from the row's stored unread flag.
  3. **Copy session path** — copies the session JSONL's absolute path to the clipboard, for Claude
     rows with a known transcript. Codex rows have no discovered session file, so the item is absent.
  4. **Archive** — last and visually separated, shown only for Codex. It invokes the provider's
     `thread/archive` request and removes the card only after provider success. Claude does not show
     this item because neither Claude Code nor Claude Hooks exposes a supported archive mutation;
     Bitterless never writes Claude Desktop's private metadata to imitate one.
- There is no icon-only Open button. Double-click, `Enter`, and the menu item all run the same
  `openThread` path, so read acknowledgement, `last_opened_*` evidence, and the on-Open status sync
  are unchanged.

```text
left-edge right-click                  right-edge right-click
× ┌ Card menu ───────────┐             ┌ Card menu ───────────┐ ×
  │ Open / read / copy   │             │ Open / read / copy   │
  │ ──────────────────── │             │ ──────────────────── │
  │ Archive (Codex only) │             │ Archive (Codex only) │
  └──────────────────────┘             └──────────────────────┘

near bottom: the same complete menu flips above × instead of clipping.
```

Manual read state is an acknowledgement, not a lock: it writes only the unread flag — never
`last_opened_*`, runtime evidence, or archive state — and a later accepted Hook/App Server
observation may still change it. On a non-terminal row the toggle still writes the flag, but the dot
only becomes visible once the row settles.

Otherwise cards are unchanged except for Domain affordances:

- the `Move to Domain` group is removed from the overflow menu, together with card drag-and-drop;
- the `…` control is always present, because the read-state item always applies;
- `eyes-on-agents-hide-unavailable-claude-open-044`'s unread affordance now needs no fallback: with
  the dot in the title slot, a row with neither Open nor Preview still shows its unread attention.

Working loader, question echo, relative time from the renderer-global 10-second clock, folder
tooltip, Open deep links, read-on-open acknowledgement, hover/focus treatment, and accessibility
labels are all untouched.

## States

| state | visible behavior |
|---|---|
| no visible threads | existing full-page empty state replaces the board |
| threads exist | every visible thread in comparator order, regardless of modal search |
| search closed | one Search button in the otherwise empty Focus header |
| search open, empty query | focused input plus start-typing prompt; no result cards |
| search query has matches | complete normal cards; first/current result has selected treatment |
| search query has no matches | modal-specific no-results text; board unchanged behind it |
| `Cmd+F` pressed while open | modal closes and transient query/selection clear |
| window at its 480px minimum | the column shrinks with the board; the menu-bar title ellipsizes and every action stays reachable |

## Non-goals

- No SQLite migration, no Domain table drop, no `domain_id` removal.
- Apart from placing the visible unread-dot tier before `working`, no change to timestamp ordering,
  unread/read semantics, retained bulk-read mutation, polling, notifications, provider observation,
  or connection surfaces.
- No renaming of the retained renderer column component, its BEM block, or its LESS file; naming
  cleanup belongs to a later Domain-persistence removal if the owner asks for one.

## Acceptance criteria

- The menu bar has no `Add Domain` control, and no board column exists other than Focus.
- Focus renders every visible thread, and a read thread stays on the board.
- Ordering matches the comparator above: approval/input, visible unread dot, working, ordinary. A
  latent unread bit does not lift a working row, and a 10-second metadata refresh that only advances
  `last_activity_at` cannot move an active card.
- The Focus header contains only one Search button; no persistent input or visible **Read all**
  action remains, while the retained bulk mutation is untouched below the renderer.
- `Cmd+F` / `Ctrl+F` and Search open the modal; the same shortcut closes it; Escape, Close, and mask
  close and clear it.
- Token matching behaves as specified without narrowing Focus, and every result reuses the normal
  `ThreadCard` with a selected state.
- Up/Down wrap; Enter flushes the current draft and opens the selected provider-qualified session.
  A successful Enter, card double-click, or card-menu Open closes Search; unsuccessful Open keeps
  the query and selection available for retry.
- Typing writes only the draft; the throttled trailing commit leaves modal results matching the
  last keystroke, and closing mid-throttle cannot resurrect a stale query.
- Repeated reads of the Focus list for one snapshot reuse the same sorted array, and a renamed thread
  re-tokenizes.
- A Claude row with a preview transcript keeps its overflow menu; a row with neither Open nor
  preview still shows its unread dot.
- Domain persistence is untouched: `eyes_on_agents_domain` rows, `domain_id` values, and the XPC
  Domain methods remain present and unused by the renderer.
