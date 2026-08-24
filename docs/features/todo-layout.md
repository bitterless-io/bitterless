# Todo Domain Board Layout

Status: implemented and independently reviewed

## Product stance

Todo is a personal, multi-device task board. Its primary job is to keep every active Domain and
its incomplete tasks scannable without forcing horizontal navigation. The board follows the
background-led hierarchy already shared with EyesOnAgents: Royal Blue menu bar, near-white canvas,
cool Domain surfaces, and one warm Focus surface. It adds no new palette, font, border system, or
decorative card treatment.

## Overall layout

```text
┌ Todo ─────────── [+ Add Domain] [Archive] [MCP] [Refresh] [Settings] ┐
├──────────────────────────────────────────────────────────────────────┤
│ ┌ Focus · 300–480px ──────┐  ┌ Work · 300–480px ────────┐          │
│ │ incomplete tasks         │  │ incomplete tasks          │          │
│ └──────────────────────────┘  └───────────────────────────┘          │
│ ┌ Home · 300–480px ───────┐  ┌ MCU · 300–480px ─────────┐          │
│ │ incomplete tasks         │  │ incomplete tasks          │          │
│ └──────────────────────────┘  └───────────────────────────┘          │
│                         wrapped rows; board scrolls vertically ↓     │
└──────────────────────────────────────────────────────────────────────┘
```

Focus and every active Domain participate in one wrapping flex container. Focus is a fixed first
projection and is never included in persisted Domain ordering. Custom Domains retain their stored
order and remain draggable across wrapped rows.

## Domain creation

The board does not render a fake Add Domain column. One labelled Arco mini button with a Tabler
plus icon is the first Todo menu-bar action. It preserves the existing one-click behavior: create an
`Untitled` Domain through `todoStore.createDomain()`, append it to the active list, then bring the
new column into view. The existing inline Domain title editor remains the naming path.

The control exposes a localized tooltip and accessible name, shows a loading state, blocks
re-entry, and is disabled at the active 17-Domain limit. At constrained menu-bar widths, the text
label may hide while the plus icon, tooltip, and accessible name remain.

## Flexible columns

The wrapping container owns a 12px gap and uses:

```less
display: flex;
flex-wrap: wrap;
align-content: flex-start;
align-items: flex-start;
```

Focus and regular Domains share the exact width and height contract:

```less
width: auto;
min-width: 300px;
max-width: 480px;
max-height: 80vh;
flex: 1 1 300px;
align-self: flex-start;
```

A column grows with its task list and stops at 80% of the window height, then scrolls internally.
The cap is expressed as `80vh` — not derived from menu-bar and board-padding subtraction — so a tall
Domain always leaves visible canvas below itself and never reads as a full-height page region.

A row distributes remaining width across its columns until they reach 480px. If the remaining
space cannot fit another 300px column plus the 12px gap, the whole column moves to the next row; a
column is never squeezed below 300px. Do not use `space-between`. A capped incomplete last row may
retain trailing canvas space so column alignment and drag targets do not jump between rows.

The board hides horizontal overflow while the detail panel is closed and owns vertical page
scrolling. Each Domain retains its existing internal task-list scrolling. At exceptionally narrow
embedded widths below one column plus board padding, local horizontal overflow is permitted rather
than shrinking the Domain below 300px.

## Todo item AI source marker

AI-created Todos keep the existing compact `AI` source label, but it is a corner marker instead of
its own metadata row:

```text
AI Todo                                  Human Todo
╭AI┐──────────────────────────╮          ╭────────────────────────────╮
│  ○  Finish integration   ☆  │          │  ○  Finish integration   ☆ │
╰─────────────────────────────╯          ╰────────────────────────────╯
```

The Todo item is the positioning boundary. The marker is absolutely positioned at `top: 0` and
`left: 0`, does not consume layout height, and does not intercept pointer input. Its top-left radius
matches the Todo item's 6px radius; top-right and bottom-left are square; bottom-right retains a
small 4px radius (`border-radius: 6px 0 4px 0`). Human-created Todos render no marker and use the
same title, checkbox, subtitle, and star alignment as before. The obsolete metadata-row wrapper is
not retained.

## Detail panel

The Todo detail panel is a right-side 320px overlay at every width. It never reserves board width:
the board keeps the full window width and the wrapping calculation is identical whether the panel is
open or closed, so selecting or closing a Todo never re-flows or narrows the columns.

Because the panel overlays instead of squeezing, the strip beneath it is reached by scrolling rather
than by shrinking the board:

```less
.todo-app__board--detail-open .todo-app__board-scroll {
  overflow-x: auto;
}

.todo-app__board--detail-open .todo-app__board-draggable {
  margin-right: 320px;
}
```

The draggable keeps `width: 100%`, so the trailing margin adds exactly the panel width of scroll
slack and nothing more: scrolled fully left the board looks as it does with the panel closed, and
scrolled fully right the last column's right edge sits 12px clear of the panel's left edge. Closing
the panel restores `overflow-x: hidden` and the board returns to its single scroll position. No
spacer column and no reserved padding exist in either state.

Selecting a task, and the detail panel's own locate action, reveal the task's Domain inside the
*visible* board region — the region that ends `320px + 12px` before the board's right edge while the
panel is open — and then center the task inside that Domain's own scrollable body. Each axis keeps
`nearest` semantics: no scrolling when the column already fits, and start alignment when the column
is larger than the visible region. So a row hidden under the panel is scrolled out from under it
instead of staying invisible. The historical horizontal return-to-Focus button does not exist in the
wrapping layout; horizontal scrolling exists only as this panel-width reveal.

## Responsive reference

| available board width | expected layout |
|---|---|
| about 776px (800px window minus padding) | two columns around 382px |
| about 876px | two columns around 432px |
| below 612px | one column per row |
| detail open at any width | wrapping unchanged; the panel overlays and 320px of horizontal reveal is available |

## Component ownership

- Board and wrapping lifecycle: `src/renderer/todo/src/App.vue` and `App.less`.
- Domain surface: `components/DomainColumn/`.
- Focus surface: `components/FocusedColumn/`.
- Domain creation action: `components/MenuBar/` and the existing `todoStore.createDomain()` path.
- Detail overlay: `components/TodoDetail/`.
