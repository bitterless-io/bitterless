# Todo Domain Board Layout

Status: implementation in progress

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

Focus and regular Domains share the exact width contract:

```less
width: auto;
min-width: 300px;
max-width: 480px;
flex: 1 1 300px;
align-self: flex-start;
```

A row distributes remaining width across its columns until they reach 480px. If the remaining
space cannot fit another 300px column plus the 12px gap, the whole column moves to the next row; a
column is never squeezed below 300px. Do not use `space-between`. A capped incomplete last row may
retain trailing canvas space so column alignment and drag targets do not jump between rows.

The board hides normal horizontal overflow and owns vertical page scrolling. Each Domain retains
its existing internal task-list scrolling and height behavior. At exceptionally narrow embedded
widths below one column plus board padding, local horizontal overflow is permitted rather than
shrinking the Domain below 300px.

## Detail panel

The Todo detail panel remains a right-side 320px overlay. At normal standalone widths, the board
reserves the panel width through its content padding so the rightmost Domain is not covered and the
wrapping calculation uses the actually visible width. At constrained embedded widths, the detail
panel may overlay the board instead of reducing a Domain below its 300px minimum. Closing the panel
restores the full wrapping width; no spacer column remains in the board.

Selecting a task may bring its Domain into the nearest visible vertical board region and then
center the task inside that Domain's own scrollable body. The historical horizontal return-to-Focus
button and left-scroll calculations do not exist in the wrapping layout.

## Responsive reference

| available board width | expected layout |
|---|---|
| about 776px (800px window minus padding) | two columns around 382px |
| about 876px | two columns around 432px |
| below 612px | one column per row |
| detail open at 800px | one visible 300–480px column per row beside the panel |

## Component ownership

- Board and wrapping lifecycle: `src/renderer/todo/src/App.vue` and `App.less`.
- Domain surface: `components/DomainColumn/`.
- Focus surface: `components/FocusedColumn/`.
- Domain creation action: `components/MenuBar/` and the existing `todoStore.createDomain()` path.
- Detail overlay: `components/TodoDetail/`.

