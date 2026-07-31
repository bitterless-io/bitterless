# EyesOnAgents Layout

Status: two-line global-search result metadata implemented; owner verification pending

## Product stance

EyesOnAgents is a daylight operations board for one person supervising several Codex tasks. Its
single job is to answer: **what is running, what just finished, and where does each task belong?**

It borrows Todo's standalone window and Domain-board interaction, but none of Todo's
checkbox, due-date, repeat, subtask, or detail-editor behavior. Avoid a generic dark developer
dashboard: the surface remains calm Royal Blue, white, and cool grey, with status color used only
for live signals.

## Window and navigation

- EyesOnAgents appears as a card in Home > Mini Apps.
- Clicking the card opens/focuses one singleton standalone window.
- The obsolete authenticated Home `coding-agents` route and sidebar item are removed.
- Default size is approximately `1120 × 720`; minimum size is `800 × 600`.
- Window position, size, and always-on-top state follow the existing Mini App setting pattern.
- macOS uses a hidden titlebar with traffic-light inset; Windows uses the shared custom controls.

## Overall layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  EyesOnAgents  [+ Add Domain] ● Connections [↻ Refresh] [Bridge] [Settings]│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌ Focus [Read all]┐ ┌ All ──────── [⌕]┐ ┌ Bitterless ─────┐               │
│  │ API pagination◌│ │ [Search titles][×]│ │ App Server RPC  │                │
│  │ now      [⌂][↗]│ │ [overmind (4)▾]│ │ now      [⌂][↗]│                │
│  │ Fix migrations │ │ Release notes   │ │                 │                │
│  │ 1m       [⌂][↗]│ │                 │ │                 │                │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘                │
│                                                                              │
│  ┌ Research ──────┐ ┌ Release ────────┐                                   │
│  │ Project notes   │ │ Fix migrations │                                   │
│  │ 4h       [⌂][↗]│ │ 1d       [⌂][↗]│                                   │
│  └─────────────────┘ └─────────────────┘                                   │
│                           wrapped rows; board scrolls vertically ↓           │
└──────────────────────────────────────────────────────────────────────────────┘
```

The 32px menu bar is the drag region. The board wraps columns into as many rows as the window width
allows and owns vertical page scrolling. Each Domain has a 300px flex basis and minimum, shares the
remaining row width up to a 500px maximum, is capped at 600px high, and owns its own thread-list
scrolling beyond that height. A capped incomplete final row may retain trailing canvas space so
column alignment and drag placement stay consistent.

Focus is fixed first and visually distinct; All is fixed second. Both are projections: Focus shows
attention and All shows every non-archived thread, while cards also remain in their stored custom
Domain when assigned. The persisted `uncategorized` system Domain remains the storage fallback but
is presented as All and cannot be renamed, reordered, or deleted.

## Visual system

Use the existing Bitterless color contract as the source of truth:

| role | token |
|---|---|
| menu bar / primary action | Royal Blue `#4E5882` |
| deep text | `#323955` / `#1E2237` |
| board canvas | near-white neutral `oklch(0.985 0 0)` |
| regular Domain surface | cool neutral `oklch(0.96 0 0)` |
| Focus Domain surface | warm attention tint `oklch(0.94 0.04 60)` |
| thread item surface | white `oklch(1 0 0)` |
| working loader | Royal Blue |
| unread Open dot | red |

Typography stays on the product's existing system-font stack. Hierarchy comes from size, weight,
spacing, and alignment rather than a new font dependency.

Surface hierarchy follows Todo: background contrast separates the board, Domains, Focus, and
thread items. Domain shells, Domain headers, thread items, and the menubar Add Domain popup have no
decorative outline or persistent shadow. A thread item may gain one quiet shadow
on pointer hover without moving; keyboard focus uses a visible outline and a light background
rather than reintroducing a permanent card border.

The wrapping Domain board and its background-led hierarchy are the product signature. Thread
cards contain no decorative signal rail, source badge, status row, or `New` badge. Only a genuinely
working thread gets a compact loading indicator beside its title. The Open control gets an unread
red dot only after the thread has returned to `idle`, so neither state consumes another card row.

## Global task search

`Cmd+F` on macOS and `Ctrl+F` on Windows open one keyboard-first search modal above the current
EyesOnAgents surface. It is independent of the All column's Project and inline title filters:

```text
┌ EyesOnAgents ────────────────────────────────────────────────────────────────┐
│                                                                            │
│        ┌ Search tasks ────────────────────────────────────────────┐         │
│        │ [ Search thread titles_______________________________ ] │ fixed   │
│        ├─────────────────────────────────────────────────────────┤         │
│        │              Type a title to search tasks              │         │
│        └─────────────────────────────────────────────────────────┘         │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

The complete modal is at least 200px high and at most `80vh`. The input region remains fixed while
only the result list scrolls. An empty, cleared, or separator-only query shows no thread rows and
instead prompts the user to type. A meaningful query is split into case-insensitive title tokens
after normalizing whitespace plus common separators (`-`, `_`, `.`, `/`, `\`, `:`, `|`). Every
query token must occur in a title token, but order does not matter, so `ops git` and `git ops` both
match `ops-git`. Each result is a compact search row rather than a draggable Domain card.

Matched results use a strict two-line rhythm:

```text
┌─────────────────────────────────────────────────────────┐
│ dsh-service&viv-admin                                   │ title
│ Operations                                       Idle   │ Domain / runtime
└─────────────────────────────────────────────────────────┘
```

The first row contains only the thread title. The second row keeps the custom Domain title on the
left and runtime state on the right. `uncategorized`, missing/stale Domain references, and blank
resolved titles display `-`; All and Focus are projections and never appear as Domain labels. Long
Domain titles remain one line, ellipsize, and retain a full-value tooltip.

Opening or clearing the modal leaves selection empty. A meaningful query with matches selects its
first result. Selection is stored by thread ID so an Open acknowledgement or polling refresh cannot
silently move selection to a different thread when attention ordering changes. Background updates
preserve a selected thread that remains in the result set and otherwise fall back to the first
current match.

| input | behavior |
|---|---|
| `Cmd+F` / `Ctrl+F` | suppress native page Find, open the modal, and focus the input |
| repeated shortcut | keep the modal open and refocus the input |
| `ArrowDown` | move to the next result, stopping at the last row |
| `ArrowUp` | move to the previous result, stopping at the first row |
| `Enter` | open the selected Codex task and keep the modal/query active |
| click result | select and open the task and keep the modal/query active |
| `Escape` | close the modal and clear its transient query/selection |

## Header behavior

The menu bar shows:

- application title;
- a labelled `Add Domain` control whose anchored form creates a custom Domain without occupying a
  board column;
- App Server connection dot and compact state text;
- labelled `Refresh`, available from connected, disconnected, and error states and disabled while
  another board action, connection, or synchronization is in flight; while the renderer remains
  mounted, one idempotent store-owned poll requests a silent tiered field refresh every 10 seconds
  when connection intent allows it;
- independent Codex observation status/action;
- a compact settings/always-on-top control and platform window controls.

Clicking the connection status opens a small panel with:

- managed App Server status and `Connect`/`Disconnect`;
- last successful sync time and latest error, if any;
- an explicit note that this connection does not attach to Codex Desktop's private stdio process;
- Codex observation status with `Enable`, `Review in Codex`, `Check again`, `Repair`, or `Disable`;
- an always-visible four-step guide covering installation/repair, Codex review, Bitterless
  verification, and the independent default-off latest-question permission; reason-specific review
  text appears above it only when attention is needed.

The panel separates the two lifecycles visually and semantically:

```text
┌ Connections ────────────────────────────────────────────────┐
│ App Server · Disconnected                     [Connect]     │
│ Thread inventory and this server's lifecycle notifications │
│                                                            │
│ Codex observation · Needs review              [Review]     │
│ Installed globally · Listener active          [Check again]│
│ ┌ Codex observation setup ──────────────────────────────┐ │
│ │ 1 Install/Repair  2 Review if asked  3 Verify status  │ │
│ │ 4 Optional question preview · Off by default          │ │
│ │ CLI: /hooks · Hook trust is not content permission    │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                [Disable]    │
└─────────────────────────────────────────────────────────────┘
```

App Server Connect/Disconnect never installs or removes observation. The observation section shows
local installation, Codex trust, and current listener as separate facts. It reports **Installed,
paused** rather than **Observing** when trusted hooks exist but the listener is not running. A user
who skipped trust or disabled a hook always retains Review and Check actions.

The Hook guide is always present while the drawer is open and uses a real conditional lifecycle
rather than another paragraph: Enable only when absent or Repair drift, use Review in Codex only
when requested, open Settings → Hooks (or enter `/hooks` in the CLI), inspect every Bitterless
definition and choose `Trust` only for items Codex marks for review, then use Check again while
pending or Check status after installation. Step 4 explains that **Store latest user question** is
independent and off by default, retains one bounded local preview only, and clears saved previews
when turned off. A disabled Hook may need only re-enabling. The
reason-specific disabled, modified, untrusted, or unavailable summary appears above the guide only
while relevant. The always-visible guide uses a quiet neutral background; amber is reserved for
that attention summary. Neither surface adds a decorative border or shadow.

The Codex observation card includes a default-off **Store latest user question** switch. Its
complete consent, busy, cleanup, error, and privacy contract lives in
[EyesOnAgents Last User Prompt](../features/eyes-on-agents-last-user-prompt.md). The connection
drawer never displays question text; the ThreadCard may display only the normalized bounded value
under the optional presentation contract below.

Clicking Add Domain opens a compact form anchored below the menubar control. The input receives
focus, uses the existing required/duplicate/`All` validation, and creates through the existing store
action. Escape, Cancel, outside dismissal, and success close and reset it. Domain creation is never
rendered as a board column.

Errors stay in this panel and as a compact board banner. They never clear already persisted threads.
The header Refresh action reconnects when necessary and reconciles active plus archived inventories;
it is always visible as the manual fallback for missed activation or lifecycle updates. The
automatic ten-second refresh skips rather than queues a tick while any snapshot load, connection,
sync, board action, or earlier poll is in flight. It never overrides an explicit Disconnect, starts
a second interval, or adds a Hook polling path. Its dedicated background promise does not drive
either Refresh loading indicator. Each tick processes the 40 most recent persisted All rows, then
one round-robin cold page of at most 40, updating title, runtime/activity, and opted-in
latest-question data; activation and manual Refresh retain full inventory reconciliation.

## Domain column

Each Domain header contains its title and at most one projection-specific action: a custom Domain
shows its management control, All shows Search, and Focus shows `Read all`. The compact Focus action
is always present to keep the header stable and is disabled when no completed unread attention item
can be cleared. While its mutation is in flight it shows the existing mini-button loading treatment
and is disabled with the other foreground board actions. No Domain, Focus, All, or filtered-result
count is rendered in the header. A custom Domain title enters inline edit when
clicked, matching Todo: the input measures its content between 40px and 200px, focuses and selects on
entry, commits through blur or Enter, and cancels with Escape. Focus and All never show an editable
cursor or input. The custom Domain overflow menu contains Delete only; the separate Rename action is
removed. Custom Domains remain reorderable. Deleting requires confirmation and states that its
threads remain available in All; it never deletes Codex tasks.

A regular Domain is one continuous cool-neutral background surface: its header has no divider or
independent card background. Focus uses the same structure with a warm attention background, so
its distinction does not depend on a border, top rule, or shadow.

The scrollable Domain body has no top padding, so its Project filter or first thread begins directly
below the header region. It retains 9px horizontal and bottom padding for column-edge spacing.

All alone has one compact Project filter between its header and scrollable thread list. It is a
searchable mini Select with `All`, `No project`, and one option per current Git Project across every
visible thread. Options include counts; same-named Projects expose a shortened root. The Select uses
a quiet background instead of a decorative border and retains a visible keyboard focus outline.
Filtering never changes Focus, custom Domains, or the stored Domain of any thread. Project option
counts remain available inside the filter, without adding a separate Domain-header count row.

The All header also contains one icon-only Search button. It expands a compact title-search row above
the Project filter and moves focus into the input. The query is trimmed and matched as a
case-insensitive substring of `thread.title` only; it does not search IDs, paths, Project names,
prompts, or response content. Title and Project filters compose, while Focus and custom Domains remain
unchanged. The explicit clear button empties the title query and restores the result set for the
currently selected Project filter. Pressing Escape or closing the Search control also clears the
query before hiding the row, so no invisible filter remains active. The row and controls use quiet
background contrast, mini sizing, visible focus, and no decorative border or shadow.

The Focus header's `Read all` is a compact text action with the same transparent, borderless header
treatment. Clicking it clears the persisted unread marker for every currently non-archived unread
thread in a confirmed terminal state — `idle`, `failed`, or `ended` — in one SQLite mutation. The
same snapshot removes each corresponding red Open dot in Focus, All, and any custom Domain
immediately; a terminal thread that was present only because it was unread leaves Focus. Working,
waiting, and `unknown` rows are deliberately not acknowledged: they remain in Focus and retain the
latent unread marker that makes a later idle transition visible even if its terminal event is
missed. The action is enabled only while such a terminal unread row exists, never opens Codex or
changes `last_opened_*`, and a later accepted active or terminal observation may set a cleared
thread unread again.

Domain creation does not occupy a board column. The labelled menubar control opens the anchored form
described in Header behavior; required, duplicate, and reserved-`All` errors remain inline there.
Keyboard focus is visible, `Esc` or Cancel closes and resets, and `Enter` submits the form.

Thread cards can be dragged between custom Domain columns. Focus and All are not sortable storage
lists and do not participate in Domain ordering. A card dragged from Focus or All is cloned into a
custom Domain before the underlying assignment changes, so it never disappears from either
projection. All does not accept drops because it already contains every thread; the card Domain
menu's All destination removes a custom classification.

## Thread card

A card displays only observation metadata:

- title, falling back to a shortened UUID; its default/minimum height is one 18px line and it grows
  only when text wraps, up to a 36px/two-line maximum before clamping;
- a compact loading indicator to the title's right only while the thread is actively working;
- one optional quiet question echo between title and actions: the bounded latest user question on
  `available`, localized **last user question pending** on `pending`, and no row on `unavailable`;
- relative last-activity time at the far left of the action row, derived from one renderer-global
  reactive clock that advances every 10 seconds so visible cards update without receiving a new
  thread snapshot;
- working-directory folder, icon-only `Open`, and Domain overflow controls grouped at the right of
  the same action row; the folder exposes the full path through tooltip/accessibility text;
- an unread red dot at the Open control's upper-right only when `isUnread` is true and
  `runtimeState === 'idle'` after a reply finishes. Working, waiting, failed, ended, and unknown
  cards never show this dot.

The action row uses 20px control boxes so it, not Arco's default 24px mini-button height, determines
the compact card height. Its folder, Open, and More glyphs are respectively 10px, 9px, and 12px —
each 4px smaller than the preceding card treatment. Tooltips, focus, click targets, and loading state
remain attached to the full control box rather than the glyph alone.

The presentation clock is renderer-local and transient. One store-owned interval serves the whole
EyesOnAgents window; thread cards never create their own timers, and clock ticks never trigger IPC,
App Server synchronization, Hook inspection, or persistence.

The card has no separate status or metadata row. It is an unbordered white item with a compact
radius and no persistent shadow. Pointer hover
uses a slightly tinted background and Todo-strength light shadow, with no vertical lift. Keyboard
focus uses a light Royal Blue background plus an explicit focus outline. The loading indicator and
idle-unread dot are the only visible status marks and do not create another visual region. The card
and Open control keep localized runtime/unread accessibility text for the state currently shown,
so these states do not depend on color alone.

The whole card may focus keyboard navigation, but only `Open`, double-click, or `Enter` launches
Codex and marks the observed turn read after the deep link succeeds. Dragging or selecting never
marks read.

```text
┌────────────────────────────────────────┐
│ Thread title, one or two lines       ◌ │
│ latest user question…                  │  available or pending only
│ now                         [⌂][↗][…] │
└────────────────────────────────────────┘
```

The question echo is 11px/14px, single-line, muted, and ellipsized. It has no icon, label badge,
border, background, or spinner. Display-only whitespace folding does not rewrite SQLite. Its native
tooltip and card accessibility label retain the full stored bounded preview and disclose
truncation. Pending says **待同步/pending**, not **fetching**, because the App Server may be offline.

Cards sort by attention first. Active cards use persisted `status_observed_at` descending within
the same attention rank, representing the time the task entered its current working/waiting state.
Reply, title, question, and `last_activity_at` refreshes cannot move an active card. A missing or
invalid active timestamp sorts as zero rather than falling back to message activity. Non-active
cards keep `last_activity_at` (then completion time) descending. Every equal-rank/equal-time result
uses immutable thread ID ascending, so SQLite input order cannot move a card. Domain assignment is
manual; thread order is intentionally not separately persisted.

## Focus ordering

Focus uses this stable order:

1. waiting for approval;
2. waiting for user input;
3. working;
4. newly completed unread;
5. newest current-state entry within the same active group;
6. newest activity within the same non-active group;
7. thread ID ascending as the stable final tie-breaker.

Focus, All, custom Domains, and global search share this comparator. The hot/cold SQLite refresh
pages continue to use activity order for fetch-budget allocation; they do not define presentation
order. A genuine runtime transition may change `status_observed_at` and reposition a card, while a
reply-only metadata update may not.

Opening any card records deep-link evidence only after the deep link succeeds, and acknowledges
unread only for a confirmed terminal card. An unread completed card leaves Focus. A working,
waiting, or `unknown` card stays in Focus while it is opened and keeps its latent unread marker
until its state actually resolves.

## States

| state | visible behavior |
|---|---|
| first launch, disconnected | connection callout plus persisted board if any |
| connecting | dot and button spinner; existing content remains interactive |
| syncing or connecting | existing cards retained; duplicate Refresh disabled |
| no threads | concise prompt to connect/sync; no fake sample rows |
| no Focus items | quiet “Nothing needs attention” state |
| working unread | title-side loader; no Open unread dot |
| working opened | card stays in Focus with its loader; only a terminal observation can retire it |
| working completes to idle unread | loader disappears; unread dot appears at Open's upper-right |
| new idle/unread completion | the supplied tone plays once and one localized system notification names the thread |
| latest question available | one muted, ellipsized question line; tooltip/accessibility retain the bounded preview and disclose truncation |
| latest question pending | one muted localized pending line; no spinner or false claim that a request is running |
| latest question unavailable/default-off | no question line and no additional card height |
| All Project filter has no matches | selected option remains available with scoped empty text |
| All title search closed | Search icon remains in the All header; no title query affects the list |
| All title search open | compact focused input plus explicit Clear control appears above Project filter |
| All title search has no matches | title-search-specific empty text appears; Focus/custom Domains remain unchanged |
| global search opened/cleared | modal input is focused; zero result rows and start-typing guidance |
| global search has matches | first row is selected; keyboard selection remains visible and scrolls into view |
| global result has custom Domain | second line shows Domain left and runtime state right |
| global result is unclassified/stale | second-line Domain value is `-`; runtime state remains visible |
| global search has no matches | localized empty result occupies the bounded result region; Enter is a no-op |
| global search result opened | exact Codex task opens; modal, query, input, and selected thread remain available |
| Add Domain closed/open | labelled menubar control; opening shows a focused anchored form and no board placeholder column |
| App Server error | neutral/error banner with retry; header Refresh remains available and persisted states are not rewritten |
| bridge absent | App Server remains usable; Desktop coverage note appears in connection panel |
| any bridge state | Install/Repair → Review if requested → Check status → optional default-off question permission guide remains visible in the open drawer |
| bridge needs review | ordered guide shows Review → inspect Hooks/Trust flagged items → Check again, includes `/hooks`, and keeps Review plus Check available |
| bridge trust inspection unavailable | the same ordered manual guide remains visible without claiming that the Hooks are trusted |
| bridge disabled in Codex | Review safely re-enables only exact Bitterless entries, then still requires Codex trust when applicable |
| bridge installed, listener stopped | explicit `Installed, paused`; never claim live observation |
| unknown runtime | accessible runtime label remains `Unknown`; no working loader is shown |
| long title/path | title grows from one 18px line to at most two/36px; folder metadata stays icon-only with full-path tooltip |

## Accessibility and responsive behavior

- Interactive controls have visible keyboard focus and accessible labels.
- Status never depends on color alone: the card's accessible label retains the normalized runtime
  text, the working loader has a status label, and visible idle-unread augments the Open control's
  label.
- At the minimum window size, columns remain at least 300px, wrap into multiple rows, and the board owns
  vertical scrolling instead of collapsing into an unreadable grid.
- No column exceeds 600px; a longer thread list scrolls inside that column without stretching its
  row or the surrounding columns.
- Dialogs and connection panels remain within the viewport and own their vertical scrolling.
- Global search exposes a listbox/option relationship and an accessible selected state; keyboard
  movement scrolls the selected option into view without moving the page.
- Drag is an enhancement: each thread overflow menu also provides a Domain selector.
- The only card-level animation is the working loader; it becomes static under reduced-motion.

## Component boundary

```text
MiniApp card -> EyesOnAgentsWindowHandler -> standalone renderer

EyesOnAgentsApp
  ├─ EyesOnAgentsMenuBar
  │    └─ AddDomainPopover (anchored form)
  ├─ ConnectionPanel
  ├─ ThreadSearch (global modal)
  │    └─ ThreadSearchResult × N
  └─ AgentBoard
       ├─ FocusColumn (derived)
       ├─ AllColumn (all non-archived threads)
       │    └─ ProjectFilter
       └─ CustomDomainColumn × N
            └─ ThreadCard × N
```

Components may follow Todo's interaction pattern, but they must not import Todo-private stores or
business components. State lives in a dedicated reactive class store; Vue components remain thin.
