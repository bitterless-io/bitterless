# EyesOnAgents Layout

Status: implemented and independently verified

## Product stance

EyesOnAgents is a daylight operations board for one person supervising several Codex tasks. Its
single job is to answer: **what is running, what just finished, and where does each task belong?**

It borrows Todo's standalone window and horizontal Domain-board interaction, but none of Todo's
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
│  EyesOnAgents        ● App Server connected  [↻ Refresh] [Bridge] [Settings]│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌ Focus ─────────┐ ┌ Uncategorized ─┐ ┌ Bitterless ─────┐ ┌ + Domain ─┐  │
│  │ 3 signals      │ │ 4 of 12 threads │ │ 4 threads       │ │           │  │
│  │                 │ │ [overmind (4)▾] │ │                 │ │           │  │
│  │ Working         │ │ Unknown         │ │ Waiting input   │ │           │  │
│  │ API pagination │ │ Release notes   │ │ App Server RPC  │ │           │  │
│  │ /repo/a · now  │ │ /repo/b · 2h   │ │ /repo/a · now   │ │           │  │
│  │             [↗]│ │             [↗] │ │             [↗] │ │           │  │
│  │                 │ │                 │ │                 │ │           │  │
│  │ Finished · new  │ │ Idle            │ │ Idle            │ │           │  │
│  │ Fix migrations │ │ UI polish       │ │ Hook bridge     │ │           │  │
│  │ /repo/c · 3m   │ │ /repo/c · 1d   │ │ /repo/a · 4h   │ │           │  │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ └───────────┘  │
│                      horizontal board scroll →                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

The 32px menu bar is the drag region. The board owns horizontal scrolling. Each 300px Domain
column owns its own vertical scrolling, so long histories do not move the header or other columns.

Focus is fixed first and visually distinct, but it is a projection: its cards also remain in their
real Domain. `Uncategorized` is the first real Domain and cannot be renamed, moved behind user
Domains, or deleted.

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
| waiting / unread completion text | amber / accent orange `#C2410C` |
| working status text | Royal Blue |
| failure status text | red |
| idle / ended / unknown text | neutral grey |

Typography stays on the product's existing system-font stack. Hierarchy comes from size, weight,
spacing, and alignment rather than a new font dependency.

Surface hierarchy follows Todo: background contrast separates the board, Domains, Focus, and
thread items. Domain shells, Domain headers, thread items, and the add-Domain surface have no
decorative outline or persistent shadow. A thread item may gain one quiet shadow
on pointer hover without moving; keyboard focus uses a visible outline and a light background
rather than reintroducing a permanent card border.

The horizontal Domain board and its background-led hierarchy are the product signature. Thread
cards contain no decorative signal rail, source badge, or ambient status animation. Runtime state
is communicated directly by its text label; unread work retains the compact `New` badge.

## Header behavior

The menu bar shows:

- application title;
- App Server connection dot and compact state text;
- labelled `Refresh`, available from connected, disconnected, and error states and disabled while
  another board action, connection, or synchronization is in flight;
- independent Codex observation status/action;
- a compact settings/always-on-top control and platform window controls.

Clicking the connection status opens a small panel with:

- managed App Server status and `Connect`/`Disconnect`;
- last successful sync time and latest error, if any;
- an explicit note that this connection does not attach to Codex Desktop's private stdio process;
- Codex observation status with `Enable`, `Review in Codex`, `Check again`, `Repair`, or `Disable`.

The panel separates the two lifecycles visually and semantically:

```text
┌ Connections ────────────────────────────────────────────────┐
│ App Server · Disconnected                     [Connect]     │
│ Thread inventory and this server's lifecycle notifications │
│                                                            │
│ Codex observation · Needs review              [Review]     │
│ Installed globally · Listener active          [Check again]│
│ Open Codex Settings → Hooks, or enter /hooks.  [Disable]    │
└─────────────────────────────────────────────────────────────┘
```

App Server Connect/Disconnect never installs or removes observation. The observation section shows
local installation, Codex trust, and current listener as separate facts. It reports **Installed,
paused** rather than **Observing** when trusted hooks exist but the listener is not running. A user
who skipped trust or disabled a hook always retains Review and Check actions.

Errors stay in this panel and as a compact board banner. They never clear already persisted threads.
The header Refresh action reconnects when necessary and reconciles active plus archived inventories;
it is always visible as the manual fallback for missed activation or lifecycle updates.

## Domain column

Each real Domain header contains title, count, and an overflow menu. User Domains can be renamed,
reordered, or deleted. Deleting requires confirmation and states that threads will move to
`Uncategorized`; it never deletes Codex tasks.

A regular Domain is one continuous cool-neutral background surface: its header has no divider or
independent card background. Focus uses the same structure with a warm attention background, so
its distinction does not depend on a border, top rule, or shadow.

`Uncategorized` alone has one compact Project filter between its header and scrollable thread list.
It is a searchable mini Select with `All`, `No project`, and one option per current Git Project in
Uncategorized. Options include counts; same-named Projects expose a shortened root. The Select uses
a quiet background instead of a decorative border and retains a visible keyboard focus outline.
While filtered, the header reports visible and total counts. Filtering never changes Focus, custom
Domains, or the stored Domain of any thread.

The final narrow add column creates a Domain inline. Empty or duplicate titles remain editable with
an inline validation message. Its button/form uses the regular Domain background without a dashed
outline. Hover deepens the background; keyboard focus retains a visible outline. `Esc` cancels and
`Enter` confirms.

Thread cards can be dragged between real Domain columns. Focus is not a storage destination and
does not participate in Domain ordering. A Focus card may be dragged into a real Domain to classify
the underlying thread.

## Thread card

A card displays only observation metadata:

- runtime label;
- unread badge for running or terminal attention observed since the last successful EyesOnAgents Open;
- title, falling back to a shortened UUID;
- compact working-directory basename/path;
- relative last-activity time;
- an icon-only `Open` action with localized tooltip and accessible label.

The card is an unbordered white item with a compact radius and no persistent shadow. Pointer hover
uses a slightly tinted background and Todo-strength light shadow, with no vertical lift. Keyboard
focus uses a light Royal Blue background plus an explicit focus outline. Status color is applied
only to the runtime text and unread badge; it does not create another visual region.

The whole card may focus keyboard navigation, but only `Open`, double-click, or `Enter` launches
Codex and marks the observed turn read after the deep link succeeds. Dragging or selecting never
marks read.

Cards sort by attention first, then `last_activity_at` descending. Domain assignment is manual;
thread order is intentionally not persisted in the first delivery.

## Focus ordering

Focus uses this stable order:

1. waiting for approval;
2. waiting for user input;
3. working;
4. newly completed unread;
5. newest activity within the same group.

Opening an unread completed card removes it from Focus after the open succeeds. Opening a running
card leaves it in Focus until the runtime state changes.

## States

| state | visible behavior |
|---|---|
| first launch, disconnected | connection callout plus persisted board if any |
| connecting | dot and button spinner; existing content remains interactive |
| syncing or connecting | existing cards retained; duplicate Refresh disabled |
| no threads | concise prompt to connect/sync; no fake sample rows |
| no Focus items | quiet “Nothing needs attention” state |
| Project filter has no matches | selected option remains available; `0 of total` and scoped empty text |
| App Server error | neutral/error banner with retry; header Refresh remains available and persisted states are not rewritten |
| bridge absent | App Server remains usable; Desktop coverage note appears in connection panel |
| bridge needs review | Review opens Codex Settings and gives Settings → Hooks plus `/hooks` instructions; Check remains available |
| bridge disabled in Codex | Review safely re-enables only exact Bitterless entries, then still requires Codex trust when applicable |
| bridge installed, listener stopped | explicit `Installed, paused`; never claim live observation |
| unknown runtime | explicit neutral `Unknown`; never rendered as idle |
| long title/path | two-line title and single-line ellipsis path with tooltip |

## Accessibility and responsive behavior

- Interactive controls have visible keyboard focus and accessible labels.
- Status never depends on color alone; every runtime state has a text label.
- At the minimum window size, columns remain 280-300px and the board scrolls horizontally instead
  of collapsing into an unreadable grid.
- Dialogs and connection panels remain within the viewport and own their vertical scrolling.
- Drag is an enhancement: each thread overflow menu also provides a Domain selector.
- No card-level ambient animation is used; other application motion still respects reduced-motion
  preferences.

## Component boundary

```text
MiniApp card -> EyesOnAgentsWindowHandler -> standalone renderer

EyesOnAgentsApp
  ├─ EyesOnAgentsMenuBar
  ├─ ConnectionPanel
  └─ AgentBoard
       ├─ FocusColumn (derived)
       ├─ DomainColumn × N
       │    ├─ ProjectFilter (Uncategorized only)
       │    └─ ThreadCard × N
       └─ AddDomainColumn
```

Components may follow Todo's interaction pattern, but they must not import Todo-private stores or
business components. State lives in a dedicated reactive class store; Vue components remain thin.
