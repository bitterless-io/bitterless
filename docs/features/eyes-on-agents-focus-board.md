# EyesOnAgents Focus-Only Board

Status: implemented; owner verification pending

Date: 2026-08-19

## Decision

The Domain board is retired from the EyesOnAgents UI. One `Focus` column becomes the whole board and
lists **every** visible thread instead of only attention items. Focus keeps all of its existing
behavior — comparator, `Read all`, unread semantics, card affordances — and gains only the two
narrowing controls that used to live in `All`.

The owner reported that Domains are unused. Removal is deliberately staged:

| layer | this delivery |
|---|---|
| renderer UI (`Add Domain`, custom Domain columns, `All` column, card `Move to Domain`, drag) | removed |
| renderer store Domain actions and Domain projections | removed |
| Main/preload persistence, `eyes_on_agents_domain` table, `domain_id`, XPC Domain methods | **retained, unexposed** |

No SQLite migration, no `domain_id` change, and no XPC handler removal happen here. Every thread
keeps its stored Domain assignment, and the `uncategorized` system Domain remains the storage
fallback, so restoring or finishing the removal stays a local decision.

## Board layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  EyesOnAgents   ● Connected  [↻ Refresh] [Bridge] [Pin]                      │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌ ⌖ Focus            [⌕] [Read all] ┐                                       │
│  │ [ Search titles              ][×] │                                       │
│  │ [ Project: overmind (4)        ▾ ]│                                       │
│  │ ┌───────────────────────────────┐ │                                       │
│  │ │ ◉ API pagination refactor   ◌ │ │  working                              │
│  │ │ now                  [⌂][↗]  │ │                                       │
│  │ ├───────────────────────────────┤ │                                       │
│  │ │ ◉ Fix migrations            ◌ │ │  waiting / working                    │
│  │ │ 1m                   [⌂][↗]  │ │                                       │
│  │ ├───────────────────────────────┤ │                                       │
│  │ │ ◉ Release notes              │ │  unread (red dot at Open)             │
│  │ │ 4m                   [⌂][↗•] │ │                                       │
│  │ ├───────────────────────────────┤ │                                       │
│  │ │ ◉ Project notes              │ │  ordinary read                        │
│  │ │ 4h                   [⌂][↗]  │ │                                       │
│  │ └───────────────────────────────┘ │ column body scrolls ↓                 │
│  └───────────────────────────────────┘                                       │
│   300px fixed width · fills the window height · no wrapping, no second column│
└──────────────────────────────────────────────────────────────────────────────┘
```

- The column is a fixed 300px wide box — the previous minimum width — anchored to the board's left
  edge. It no longer flexes to 500px and no longer wraps, because there is nothing to wrap against.
- The column fills the available height from below the menu bar to the bottom board padding. The
  600px cap is removed; the thread list scrolls inside the column body, and the board itself no
  longer owns vertical scrolling.
- The warm Focus attention tint, header treatment, 9px body padding, and card spacing are unchanged.
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

The header keeps its target glyph and `Focus` title, and holds exactly two actions:

| control | behavior |
|---|---|
| `⌕` Search toggle | expands/collapses the inline title filter row and moves focus into its input |
| `Read all` | unchanged: one SQLite mutation clearing unread for every visible unread thread in a confirmed terminal state (`idle`, `failed`, `ended`); disabled when no such row exists |

Removed from the header: inline title editing, the overflow/Delete menu, the drag handle, and every
Domain-management affordance. The title is a plain non-editable heading again.

`Read all` semantics are untouched: working, waiting, and `unknown` rows are still not acknowledged
and keep their latent unread marker. Because rows no longer leave the board when acknowledged, the
only visible effect is that each cleared row loses its red Open dot in place.

## Search — one filter, no modal

The global search modal (`ThreadSearch`) is removed. `Cmd+F` / `Ctrl+F` now drives the Focus
column's own filter:

| input | behavior |
|---|---|
| `Cmd+F` / `Ctrl+F` | suppress native page Find, expand the Focus search row if collapsed, focus its input |
| repeated shortcut | keep the row open and refocus the input; the query is preserved |
| typing | filter the Focus list live |
| `×` clear | empty the query, keep the row open and focused |
| `Escape` in the row | clear the query and collapse the row |

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

## Project filter

The Project Select moves from `All` into the Focus column, directly under the search row and above
the thread list. Its contract in
[EyesOnAgents Project filter](eyes-on-agents-project-filter.md) is otherwise unchanged: `All`,
`No project`, one option per current Git Project across visible threads, truthful counts, sorted by
display name then root, renderer-session state only, never written to SQLite, never changing
`domain_id`.

The title filter and the Project filter compose: a card must satisfy both. The empty state names
the active reason — title search, selected Project, or `No project`.

## Thread card

Cards are unchanged except for Domain affordances:

- the `Move to Domain` group is removed from the overflow menu, together with card drag-and-drop;
- the overflow (`…`) control renders only when it has an action — today that is the Claude
  **Preview transcript** option for a row with a canonical JSONL;
- when a row has no Open control and no overflow action but must show unread attention, the unread
  red dot renders as a standalone marker in the action row, so
  `eyes-on-agents-hide-unavailable-claude-open-044`'s unread affordance survives with no empty menu.

Working loader, question echo, relative time from the renderer-global 10-second clock, folder
tooltip, Open deep links, read-on-open acknowledgement, hover/focus treatment, and accessibility
labels are all untouched.

## States

| state | visible behavior |
|---|---|
| no visible threads | existing full-page empty state replaces the board |
| threads exist, no filter | every visible thread in comparator order |
| search row collapsed | `⌕` remains in the header; no title query narrows the list |
| search row open, empty query | focused input, explicit clear control, full list |
| search query has no matches | title-search empty text inside the column |
| Project filter has no matches | Project-specific or `No project` empty text |
| both filters active, no matches | title-search empty text takes precedence |
| `Read all` unavailable | disabled compact text action; header layout unchanged |
| board action in flight | `Read all` and other foreground actions disabled, existing loading treatment |
| window narrower than the column | column keeps 300px; the board clips rather than shrinking the column |

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
- `Cmd+F` opens and focuses the Focus search row; typing narrows the visible cards; `Escape` clears
  and collapses; no modal appears anywhere in the app.
- Token matching, Project filtering, and their composition behave as specified, with truthful empty
  states.
- A Claude row with a preview transcript keeps its overflow menu; a row with neither Open nor
  preview still shows its unread dot.
- Domain persistence is untouched: `eyes_on_agents_domain` rows, `domain_id` values, and the XPC
  Domain methods remain present and unused by the renderer.
