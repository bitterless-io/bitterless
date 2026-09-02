# Motto Mini App

Status: Implemented

## Purpose

Motto is a quiet, local reminder surface inside Omni. It keeps a short vertical collection of
important statements, each expressed as a title and supporting subtitle. The renderer owns the
complete feature; no Main-process service, account, network request, or standalone window is
required.

## Design Principles

- Match Translator's compact embedded-app shell, the shared mini-app MenuBar effect, and the
  Bitterless Royal Blue system.
- Spend visual emphasis on the reminder cards: calm white surfaces, a strong red title, and a
  quieter muted-red subtitle.
- Keep management actions available but visually secondary.
- Use shared renderer i18n and Arco controls. Use Tabler icons and shallow `motto` BEM classes.

### Card Palette

| Token           | Hex       | Usage                                 |
| --------------- | --------- | ------------------------------------- |
| page surface    | `#F3F5FC` | quiet background around the list      |
| card surface    | `#FFFFFF` | reminder card                         |
| card border     | `#E2E4EB` | neutral card outline                  |
| reminder strong | `#B42318` | card title                            |
| reminder muted  | `#A65F59` | optional subtitle                     |
| chrome          | `#4E5882` | MenuBar surface                       |
| chrome line     | `#3D4666` | MenuBar bottom divider                |
| chrome ink      | `#F6F7FC` | MenuBar identity, title, and Add icon |

The title uses the strong red. The subtitle uses only the muted red; red does not spread to the
MenuBar, Add action, menu, inline editor controls, or page background.

### MenuBar

Motto's top strip is the shared mini-app MenuBar effect already used by EyesOnAgents, Submodules,
and Todo, reproduced by copy rather than by importing another mini app's private component. It is
exactly 32px tall with `0 10px` padding, the Royal Blue `chrome` surface, the `chrome line` bottom
divider, and `chrome ink` content: a 16px leading notes icon, then the 13px/650 application title,
ellipsized before it can push the Add action.

Motto runs only as an Omni mini-app cell, so the bar reproduces the embedded variant of that effect
only: no drag region, no macOS traffic-light gutter, no window controls, and no double-click
maximize.

## Overall Structure

```text
┌──────────────────────────────────────────────────────────────┐
│ ▤ Motto                                                 [＋] │  32px MenuBar
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Important title                                  [⠿][…] │ │
│ │ Supporting subtitle                                     │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Another title                                    [⠿][…] │ │
│ │ Another supporting subtitle                             │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The MenuBar remains fixed. Its Add action is an icon-only plus button with no visible text, sized
as the shared 27px light MenuBar control; the icon is centered horizontally and vertically inside
the button, while localized `title` and `aria-label` text preserve its accessible name. Clicking it
adds one UI-only draft card at the end of the list and immediately focuses that card's Title editor.
The vertically stacked card region owns scrolling and keeps one column at every supported pane
width.

## Cards And Inline Editing

```text
┌──────────────────────────────────────────────────────────┐
│ [Title editor — focused after Add]                [⠿][…] │
│ Add subtitle                                             │
└──────────────────────────────────────────────────────────┘
```

- Every card uses `8px` padding and has no colored left rule.
- Title and Subtitle are separate keyboard-focusable text targets. Clicking either replaces that
  text with its inline editor and focuses it. An empty Subtitle renders the localized Subtitle
  placeholder so it remains directly editable.
- In display mode, Title and Subtitle wrap naturally but are each clamped to at most two lines with
  an ellipsis.
- Title remains required after trimming. Subtitle remains optional and is stored as an empty string
  when cleared.
- `Enter` or blur commits a valid edit. `Esc` restores an existing value or discards a new draft.
  An empty edited Title restores its previous value; an empty new Title discards the draft.
- Add creates only a UI draft until a non-empty Title commits. A successful commit appends the new
  item through the normal whole-array persistence path; a failed write leaves the draft active for
  retry.
- The Add/Edit modal is removed.

## Card Actions

Each persisted card has a drag handle and a top-right ellipsis button. The ellipsis opens an Arco
dropdown containing Delete only. Delete removes the card immediately and closes the menu; no
confirmation dialog is added for this small local list. Dragging by the handle reorders cards; drag
is disabled while an inline editor is active so text editing and reordering cannot compete.

## Persistence Contract

- Storage key: `bitterless.motto.items.v1`.
- The stored value is one JSON array containing the complete ordered collection.
- Each item has exactly `{ id, title, subtitle }`. `id` and `title` are non-empty strings after
  trimming, `subtitle` is a trimmed string that may be empty, and `id` is unique within the array.
- Startup performs one whole-value read and validation. Add, inline edit, delete, and reorder each
  perform one whole-array write after producing the next collection.
- Reorder preserves every item ID and field while changing array order only. The reactive list
  changes only after the reordered whole array is written successfully.
- A missing key loads the explicit empty collection.
- Malformed or unavailable storage fails closed to an empty in-memory collection and shows a
  localized recovery alert. The invalid stored payload is not silently rewritten on load.
- A failed write keeps the last successfully persisted in-memory collection and shows the localized
  recovery alert.
- All Motto renderer instances use the same renderer origin and default Electron session, so their
  next load observes the same stored collection. Live cross-window synchronization is out of scope.

## State Variants

| State         | Card region                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| empty         | centered invitation with an Add action                                      |
| populated     | one vertical, scrollable card column                                        |
| editing       | one Title or Subtitle becomes an inline field; other cards remain visible   |
| adding        | one unpersisted card draft appears last with its Title editor focused        |
| dragging      | the dragged persisted card is visibly lifted; inline editing is unavailable |
| storage error | localized alert above the card list; last safe in-memory collection remains |
| constrained   | card text wraps, MenuBar actions remain reachable, list scrolls             |

## Interaction Contract

| Input            | Scope                  | Behavior                                        |
| ---------------- | ---------------------- | ----------------------------------------------- |
| click plus / Add | MenuBar / empty state | append UI draft and focus its Title                 |
| click text       | card Title/Subtitle   | replace that field with a focused inline editor     |
| click ellipsis   | persisted card        | open the Delete menu                               |
| click Delete     | card menu             | persist removal immediately                        |
| drag handle      | persisted card        | persist and then display the reordered array        |
| `Enter` / blur   | inline editor         | trim and commit; invalid Title restores/discards    |
| `Esc`            | inline editor         | restore existing value or discard new draft         |
| `Tab`            | card controls         | follow document order across text, drag, and menu    |

## Component Tree

```text
Motto App
├─ fixed MenuBar
│  ├─ identity icon + title
│  └─ Add icon button
├─ storage alert (conditional)
├─ scrollable card list / empty state
│  └─ motto card × N
│     ├─ inline Title / Subtitle editors
│     ├─ drag handle
│     └─ Delete dropdown
└─ pending add draft (conditional)
```

## Entry Points

- `src/preload/motto/motto.preload.ts`
- `src/renderer/motto/`
- `src/shared/omni/omni.types.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/renderer/omni/omniControl/`
