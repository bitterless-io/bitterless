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
- Spend visual emphasis on the reminder cards: calm white surfaces, one strong red rule paired with
  the title, and a quieter muted-red subtitle.
- Keep management actions available but visually secondary.
- Use shared renderer i18n and Arco controls. Use Tabler icons and shallow `motto` BEM classes.

### Card Palette

| Token           | Hex       | Usage                                 |
| --------------- | --------- | ------------------------------------- |
| page surface    | `#F3F5FC` | quiet background around the list      |
| card surface    | `#FFFFFF` | reminder card                         |
| card border     | `#E2E4EB` | neutral card outline                  |
| reminder strong | `#B42318` | card title and left rule              |
| reminder muted  | `#A65F59` | optional subtitle                     |
| chrome          | `#4E5882` | MenuBar surface                       |
| chrome line     | `#3D4666` | MenuBar bottom divider                |
| chrome ink      | `#F6F7FC` | MenuBar identity, title, and Add icon |

The title and left rule always use the same strong red. The subtitle uses only the muted red; red
does not spread to the MenuBar, Add action, menus, modal, or page background.

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
│ │ Important title                                     […] │ │
│ │ Supporting subtitle                                     │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Another title                                       […] │ │
│ │ Another supporting subtitle                             │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The MenuBar remains fixed. Its Add action is an icon-only plus button with no visible text, sized
as the shared 27px light MenuBar control; the icon is centered horizontally and vertically inside
the button, while localized `title` and `aria-label` text preserve its accessible name. The
vertically stacked card region owns scrolling and keeps one column at every supported pane width.

## Editor Modal

```text
                  ┌────────────────────────────────────┐
                  │ Add motto / Edit motto             │
                  ├────────────────────────────────────┤
                  │ Title                              │
                  │ [                                  ]│
                  │ Subtitle                           │
                  │ [                                  ]│
                  ├────────────────────────────────────┤
                  │                  [Cancel] [Add/Save]│
                  └────────────────────────────────────┘
```

- Add opens an empty form and focuses Title.
- Edit opens the selected card's current title and subtitle.
- Title is required after trimming. Subtitle is optional for both Add and Edit and is stored as an
  empty string when omitted.
- Submit stays disabled until Title is non-empty.
- Cancel, close, or `Esc` discards the draft.
- Successful Add appends a card; successful Edit updates it in place.

## Card Actions

Each card has one top-right ellipsis button. It opens an Arco dropdown menu containing Edit and
Delete. Edit opens the modal. Delete removes the card immediately and closes the menu; no
confirmation dialog is added for this small local list.

## Persistence Contract

- Storage key: `bitterless.motto.items.v1`.
- The stored value is one JSON array containing the complete ordered collection.
- Each item has exactly `{ id, title, subtitle }`. `id` and `title` are non-empty strings after
  trimming, `subtitle` is a trimmed string that may be empty, and `id` is unique within the array.
- Startup performs one whole-value read and validation. Add, edit, and delete each perform one
  whole-array write after producing the next collection.
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
| editing       | existing cards remain visible beneath the modal overlay                     |
| storage error | localized alert above the card list; last safe in-memory collection remains |
| constrained   | card text wraps, MenuBar actions remain reachable, list scrolls             |

## Interaction Contract

| Input            | Scope                  | Behavior                                        |
| ---------------- | ---------------------- | ----------------------------------------------- |
| click plus / Add | MenuBar / empty state  | open empty editor                               |
| click ellipsis   | card                   | open Edit/Delete menu                           |
| click Edit       | card menu              | open prefilled editor                           |
| click Delete     | card menu              | persist removal immediately                     |
| `Enter`          | single-line form input | follow normal form/modal submit behavior        |
| `Esc`            | modal                  | close and discard draft                         |
| `Tab`            | modal/menu             | move through controls using Arco focus behavior |

## Component Tree

```text
Motto App
├─ fixed MenuBar
│  ├─ identity icon + title
│  └─ Add icon button
├─ storage alert (conditional)
├─ scrollable card list / empty state
│  └─ motto card × N
│     └─ ellipsis dropdown
└─ add/edit modal
   └─ title + subtitle form
```

## Entry Points

- `src/preload/motto/motto.preload.ts`
- `src/renderer/motto/`
- `src/shared/omni/omni.types.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/renderer/omni/omniControl/`
