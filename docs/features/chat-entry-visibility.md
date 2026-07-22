# Chat Entry Visibility

Status: Accepted

## Purpose

Chat remains available as an experimental Home route, but production does not advertise or open it
by default. General owns one persisted switch that reveals the top-level Chat menu entry without
changing or deleting Chat data.

## Environment And Persistence Contract

| Environment | Default `showChatMenu` | Default Home destination |
|---|---:|---|
| `VITE_ENV=dev` | `true` | Chat |
| every other value | `false` | Mini Apps |

The persisted override lives in Core SQLite through `SettingDao` at `key=general`,
`sub_key=showChatMenu`. Only a stored boolean overrides the environment default. Missing,
malformed, or unreadable state keeps the environment default.

## Layout

```text
Production default                    General
┌──────┬──────────────────────┐       ┌──────────────────────────────────┐
│ Apps │ Mini Apps            │       │ Experimental features            │
│ Conn │                      │       │ Show Chat in the main menu [off] │
│      │                      │       └──────────────────────────────────┘
│  ⚙   │                      │
└──────┴──────────────────────┘

Switch enabled
┌──────┬──────────────────────┐
│ Chat │ Existing Chat route  │
│ Apps │ and content          │
│ Conn │                      │
│  ⚙   │                      │
└──────┴──────────────────────┘
```

## Interaction Contract

- General loads the visibility value from SQLite and shows the environment default until loading
  completes.
- Changing the switch updates the reactive Home menu immediately and persists the boolean.
- A failed save restores the previous value and shows a localized failure message.
- Hiding the menu while Chat is open does not destroy the route or its data. The next normal
  production launch lands on Mini Apps.
- Direct `/chat` navigation remains available for recovery and development; this flag controls the
  top-level entry, not authorization.

## Entry Points

- `src/renderer/home/src/router/defaultRoutes.ts`
- `src/renderer/home/src/views/layout/components/homeMenu/HomeMenu.vue`
- `src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue`
- `src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts`

