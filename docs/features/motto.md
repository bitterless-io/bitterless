# Motto Mini App

Status: Implemented

## Purpose

Motto is a quiet, local reminder surface inside Omni. It keeps a short vertical collection of
important statements, each expressed as a title and supporting subtitle. The renderer owns the
complete feature; no Main-process service, account, network request, or standalone window is
required.

## Design Principles

- Match Translator's compact embedded-app shell and Bitterless Royal Blue system.
- Spend visual emphasis on the reminder cards: calm white surfaces, a slim royal accent, and clear
  title/subtitle hierarchy.
- Keep management actions available but visually secondary.
- Use shared renderer i18n and Arco controls. Use Tabler icons and shallow `motto` BEM classes.

## Overall Structure

```text
┌──────────────────────────────────────────────────────────────┐
│ Motto                                              [＋ Add]  │
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

The header remains fixed. The vertically stacked card region owns scrolling and keeps one column at
every supported pane width.

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
- Title and subtitle are both required after trimming.
- Submit stays disabled until both fields are non-empty.
- Cancel, close, or `Esc` discards the draft.
- Successful Add appends a card; successful Edit updates it in place.

## Card Actions

Each card has one top-right ellipsis button. It opens an Arco dropdown menu containing Edit and
Delete. Edit opens the modal. Delete removes the card immediately and closes the menu; no
confirmation dialog is added for this small local list.

## Persistence Contract

- Storage key: `bitterless.motto.items.v1`.
- The stored value is one JSON array containing the complete ordered collection.
- Each item has exactly `{ id, title, subtitle }`, where all fields are non-empty strings after
  trimming and `id` is unique within the array.
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

| State | Card region |
|---|---|
| empty | centered invitation with an Add action |
| populated | one vertical, scrollable card column |
| editing | existing cards remain visible beneath the modal overlay |
| storage error | localized alert above the card list; last safe in-memory collection remains |
| constrained | card text wraps, header actions remain reachable, list scrolls |

## Interaction Contract

| Input | Scope | Behavior |
|---|---|---|
| click Add | header / empty state | open empty editor |
| click ellipsis | card | open Edit/Delete menu |
| click Edit | card menu | open prefilled editor |
| click Delete | card menu | persist removal immediately |
| `Enter` | single-line form input | follow normal form/modal submit behavior |
| `Esc` | modal | close and discard draft |
| `Tab` | modal/menu | move through controls using Arco focus behavior |

## Component Tree

```text
Motto App
├─ fixed header
│  └─ Add button
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
