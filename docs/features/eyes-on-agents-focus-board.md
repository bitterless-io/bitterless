# EyesOnAgents Focus-Only Board

Status: implemented; owner verification pending

Date: 2026-08-19

## Decision

The Domain board is retired from the EyesOnAgents UI. One `Focus` column becomes the whole board and
lists **every** visible thread instead of only attention items. Focus keeps all of its existing
behavior — comparator, `Read all`, unread semantics, card affordances — and gains the title filter
that used to live in `All`.

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
│ │ [ ⌕ Search titles (⌘F)                              ]      [Read all]    │ │
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
- The column surface follows window activation: the pale orange attention tint
  (`--eyes-column-focus`) while the EyesOnAgents window is active, the neutral `--eyes-column` grey
  while it is not. The state is renderer-local (`focus`/`blur` on `window`, seeded from
  `document.hasFocus()`) and exposed as one modifier class on the renderer root; an Omni-hosted cell
  stays warm because an embedded cell can sit blurred while its host window is active. Header
  treatment, 9px body padding, and card spacing are unchanged.
- The board keeps its 12px padding, so the window right of the column is empty canvas.

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

## Ordering — unchanged

The shared comparator is **not** modified. Focus keeps exactly the order defined in
[EyesOnAgents working cards reorder during replies](../issues/eyes-on-agents-working-order-churn.md):

1. `waiting_approval`
2. `waiting_input`
3. `working`
4. unread
5. every other thread

Within an active rank (1–3), `status_observed_at` descending — the time the thread entered its
current working/waiting state. A reply, title, question, or `last_activity_at` refresh must not move
an active card; a missing or invalid value sorts as zero. Within the unread rank and the ordinary
rank, `last_activity_at ?? last_completed_at` descending. Every equal-rank/equal-time comparison
ends with provider-qualified session key ascending.

This is what "working first, then unread, then the rest, newest reply first inside each state" means
here: the active tier is ordered by the start of its current turn, which is stable, and the read
tiers are ordered by latest activity. The hot/cold SQLite refresh pages keep activity order as a
fetch-budget policy and still do not define presentation order.

## Focus header controls

The header is the search row. There is no target glyph, no `Focus` heading, no `⌕` toggle, and no
`×` close control — the single column makes a title redundant, and a filter that must be opened costs
an interaction per search.

| control | behavior |
|---|---|
| search input | always visible, takes the header's remaining width, filters as you type |
| `Read all` | unchanged: one SQLite mutation clearing unread for every visible unread thread in a confirmed terminal state (`idle`, `failed`, `ended`); disabled when no such row exists |

The placeholder discloses the platform shortcut — `Search titles (⌘F)` on macOS,
`Search titles (Ctrl+F)` on Windows, resolved through the shared `uaHelper` with the `Ctrl+F` wording
as the non-macOS fallback. The accessible label stays the plain search label.

`Read all` semantics are untouched: working, waiting, and `unknown` rows are still not acknowledged
and keep their latent unread marker. Because rows no longer leave the board when acknowledged, the
only visible effect is that each cleared row loses its red Open dot in place.

## Search — one filter, no modal

The global search modal (`ThreadSearch`) is removed. `Cmd+F` / `Ctrl+F` now drives the Focus
column's own filter:

| input | behavior |
|---|---|
| `Cmd+F` / `Ctrl+F` | suppress native page Find and focus the header input; pressing it again just refocuses |
| typing | filter the Focus list live |
| `Escape` in the input | clear the query and keep focus in the input |

There is nothing to open or close, so the only reset paths are `Escape` and unmount, both of which
clear draft and query together.

Matching keeps the stronger token semantics delivered by
`eyes-on-agents-token-title-search-032` instead of the previous plain substring test:

- the query and each `thread.title` are normalized (`NFKC`), lowercased, and split on whitespace plus
  `-`, `_`, `.`, `/`, `\`, `:`, `|`;
- every query token must be contained in some title token, in any order, so `ops git` and
  `git ops` both match `ops-git`;
- an empty, whitespace-only, or separator-only query is not a filter: the full list is shown;
- only `thread.title` is matched — never thread ID, `cwd`, Project, prompt, or response content;
- a thread with no resolved title never matches a non-empty query.

There is no result-list mode, no keyboard result selection, no `Enter`-to-open, and no separate
result row rendering. Filtering narrows the real card list, so cards keep their normal Open,
Preview, unread, and accessibility behavior.

### Typing is decoupled from filtering

Two values back the row. `titleDraft` is what the input shows and updates on every keystroke;
`titleQuery` is what the list filters by. A keystroke only writes the draft and asks a shared
`useThrottleFn(run, 120, true, true)` scheduler — leading plus trailing — to publish it.

The commit reads the **current** draft rather than a captured value, so the trailing run always
publishes the newest input: the visible result set matches the last thing typed, and no earlier
keystroke can land after it. Closing or clearing resets draft and query together and immediately, so
a still-pending trailing run can only re-apply the empty query. Without a configured scheduler the
commit is synchronous, which keeps tests and non-browser callers deterministic.

Each pass is also cheap: the sorted thread list is memoized by snapshot identity and each thread's
title tokens are memoized per thread object and re-tokenized only when that title changes. Both
caches live outside the reactive store, so filling them can never trigger a render.

## Project filter — retired

The Project Select is gone from this board: no component, no `projectFilter.service.ts`, and no
selection state, options, or reconciliation in the store. Main-side Project resolution and the three
`project_*` columns stay exactly as they are, on the same "retain the storage, drop the UI" footing
as Domains — see [EyesOnAgents Project filter](eyes-on-agents-project-filter.md).

The title filter is therefore the only narrowing control, and the column empty state has two cases:
an active title filter shows the title-search text, otherwise the Focus empty text.

## Thread card

The card has one status slot and one menu:

- **Title-row status slot** — a fixed 16×18px box right of the title. It shows the working spinner
  while the row is active, the unread red dot when a terminal row is unread, and nothing otherwise.
  Spinner and dot are mutually exclusive there, so the card never grows a second status region and an
  active row never shows the dot.
- **Overflow menu** (`…`, always present):
  1. **Open in Codex** / **Open in Claude** — named for the row's provider, with a quiet
     `(double click)` / `（双击）` hint, because double-click and `Enter` do the same thing. Omitted for
     a Claude row with no trusted Desktop route.
  2. **Mark as read** / **Mark as unread** — labelled from the row's stored unread flag.
  3. **Preview transcript** — Claude rows with a canonical JSONL.
- There is no icon-only Open button. Double-click, `Enter`, and the menu item all run the same
  `openThread` path, so read acknowledgement, `last_opened_*` evidence, and the on-Open status sync
  are unchanged.

Manual read state is an acknowledgement, not a lock: it writes only the unread flag — never
`last_opened_*`, runtime evidence, or archive state — and a later accepted Hook/App Server
observation may still change it, exactly as it may after `Read all`. On a non-terminal row the toggle
still writes the flag, but the dot only becomes visible once the row settles, which is the same latent
marker `Read all` already respects.

Otherwise cards are unchanged except for Domain affordances:

- the `Move to Domain` group is removed from the overflow menu, together with card drag-and-drop;
- the overflow control is always present, because the read-state item always applies;
- `eyes-on-agents-hide-unavailable-claude-open-044`'s unread affordance now needs no fallback: with
  the dot in the title slot, a row with neither Open nor Preview still shows its unread attention.

Working loader, question echo, relative time from the renderer-global 10-second clock, folder
tooltip, Open deep links, read-on-open acknowledgement, hover/focus treatment, and accessibility
labels are all untouched.

## States

| state | visible behavior |
|---|---|
| no visible threads | existing full-page empty state replaces the board |
| threads exist, no filter | every visible thread in comparator order |
| empty query | placeholder names the platform shortcut; the full list is visible |
| search query has no matches | title-search empty text inside the column |
| `Read all` unavailable | disabled compact text action; header layout unchanged |
| board action in flight | `Read all` and other foreground actions disabled, existing loading treatment |
| window at its 480px minimum | the column shrinks with the board; the menu-bar title ellipsizes and every action stays reachable |

## Non-goals

- No SQLite migration, no Domain table drop, no `domain_id` removal.
- No change to the comparator, unread/read semantics, `Read all` mutation, polling, notifications,
  provider observation, or connection surfaces.
- No renaming of the retained renderer column component, its BEM block, or its LESS file; naming
  cleanup belongs to a later Domain-persistence removal if the owner asks for one.

## Acceptance criteria

- The menu bar has no `Add Domain` control, and no board column exists other than Focus.
- Focus renders every visible thread, and a read thread stays on the board.
- Ordering matches the comparator table above, including no active-card movement across a 10-second
  metadata refresh that only advances `last_activity_at`.
- `Read all` still clears exactly the terminal unread rows and leaves working/waiting/`unknown`
  rows marked.
- `Cmd+F` focuses the header search input; typing narrows the visible cards; `Escape` clears the
  query without hiding the input; no modal appears anywhere in the app.
- Token matching behaves as specified, with a truthful empty state, and no Project control exists.
- Typing writes only the draft; the throttled trailing commit leaves the visible list matching the
  last keystroke, and closing mid-throttle cannot resurrect a stale query.
- Repeated reads of the Focus list for one snapshot reuse the same sorted array, and a renamed thread
  re-tokenizes.
- A Claude row with a preview transcript keeps its overflow menu; a row with neither Open nor
  preview still shows its unread dot.
- Domain persistence is untouched: `eyes_on_agents_domain` rows, `domain_id` values, and the XPC
  Domain methods remain present and unused by the renderer.
