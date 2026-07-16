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
│  EyesOnAgents        ● App Server connected     [Sync] [Bridge] [Settings] │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌ Focus ─────────┐ ┌ Uncategorized ─┐ ┌ Bitterless ─────┐ ┌ + Domain ─┐  │
│  │ 3 signals      │ │ 12 threads      │ │ 4 threads       │ │           │  │
│  │                 │ │                 │ │                 │ │           │  │
│  │┃ Working        │ │┃ Unknown        │ │┃ Waiting input  │ │           │  │
│  │ API pagination │ │ Release notes   │ │ App Server RPC  │ │           │  │
│  │ /repo/a · now  │ │ /repo/b · 2h   │ │ /repo/a · now   │ │           │  │
│  │          [Open]│ │          [Open] │ │          [Open] │ │           │  │
│  │                 │ │                 │ │                 │ │           │  │
│  │┃ Finished · new │ │┃ Idle           │ │┃ Idle           │ │           │  │
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
| board canvas | cool grey-blue `#F3F5FC` |
| Domain/card surface | white |
| waiting / unread completion | amber / accent orange `#C2410C` |
| completed/read | restrained green |
| failure | red |
| unknown / disconnected | neutral grey |

Typography stays on the product's existing system-font stack. Hierarchy comes from size, weight,
spacing, and alignment rather than a new font dependency.

The signature element is a narrow **signal rail** on the left edge of every thread card. Its color
and top dot encode live state without turning the whole card into an alert. Working receives one
quiet pulse animation; `prefers-reduced-motion` disables it.

## Header behavior

The menu bar shows:

- application title;
- App Server connection dot and compact state text;
- `Sync`, disabled while synchronization is in flight;
- Codex Desktop Bridge status/action;
- a compact settings/always-on-top control and platform window controls.

Clicking the connection status opens a small panel with:

- managed App Server status and `Connect`/`Disconnect`;
- last successful sync time and latest error, if any;
- an explicit note that this connection does not attach to Codex Desktop's private stdio process;
- Desktop hook bridge status with `Install`, `Repair`, or `Remove`.

Errors stay in this panel and as a compact board banner. They never clear already persisted threads.

## Domain column

Each real Domain header contains title, count, and an overflow menu. User Domains can be renamed,
reordered, or deleted. Deleting requires confirmation and states that threads will move to
`Uncategorized`; it never deletes Codex tasks.

The final narrow add column creates a Domain inline. Empty or duplicate titles remain editable with
an inline validation message. `Esc` cancels and `Enter` confirms.

Thread cards can be dragged between real Domain columns. Focus is not a storage destination and
does not participate in Domain ordering. A Focus card may be dragged into a real Domain to classify
the underlying thread.

## Thread card

A card displays only observation metadata:

- signal rail and runtime label;
- unread `New` badge for an observed completion not opened from EyesOnAgents;
- title, falling back to a shortened UUID;
- compact working-directory basename/path;
- relative last-activity time;
- evidence source on hover or in the overflow details;
- primary `Open` action.

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
| syncing | existing cards retained; duplicate sync disabled |
| no threads | concise prompt to connect/sync; no fake sample rows |
| no Focus items | quiet “Nothing needs attention” state |
| App Server error | neutral/error banner with retry; persisted states are not rewritten |
| bridge absent | App Server remains usable; Desktop coverage note appears in connection panel |
| unknown runtime | grey rail and explicit `Unknown`; never rendered as idle |
| long title/path | two-line title and single-line ellipsis path with tooltip |

## Accessibility and responsive behavior

- Interactive controls have visible keyboard focus and accessible labels.
- Status never depends on color alone; every rail has a text label.
- At the minimum window size, columns remain 280-300px and the board scrolls horizontally instead
  of collapsing into an unreadable grid.
- Dialogs and connection panels remain within the viewport and own their vertical scrolling.
- Drag is an enhancement: each thread overflow menu also provides a Domain selector.
- Animations respect reduced-motion preferences.

## Component boundary

```text
MiniApp card -> EyesOnAgentsWindowHandler -> standalone renderer

EyesOnAgentsApp
  ├─ EyesOnAgentsMenuBar
  ├─ ConnectionPanel
  └─ AgentBoard
       ├─ FocusColumn (derived)
       ├─ DomainColumn × N
       │    └─ ThreadCard × N
       └─ AddDomainColumn
```

Components may follow Todo's interaction pattern, but they must not import Todo-private stores or
business components. State lives in a dedicated reactive class store; Vue components remain thin.
