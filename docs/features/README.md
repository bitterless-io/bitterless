# Desktop Sub-applications

## Purpose and boundary

This scope owns independently rendered desktop work surfaces opened from Maestro's two discovery
surfaces: the fixed local Home **Mini Apps** card grid and the compact **Workbench Apps** list. The
legacy Home renderer is the login/bootstrap shell and remains hidden after authenticated Maestro
startup. Each sub-application owns its window-local UI and domain runtime, while the Bitterless main
process owns the Electron application lifecycle, authentication invalidation, updates, packaging,
and final cleanup.

Maestro is the visible authenticated primary runtime. Coin, Todo, EyesOnAgents, OnlyPreview, Omni
Browser, and the Maestro focus action use one shared Mini App definition catalog across both
discovery surfaces. Each entry keeps its own window handler, renderer entries, packaged resources,
and persisted data.

```text
Bitterless Home login/bootstrap
            |
            +---- authenticated handoff ---- Maestro primary window
                                                |
                                                +---- fixed Home Mini Apps cards
                                                |       └── shared app catalog + launch actions
                                                |
                                                +---- Workbench Apps compact list
                                                        └── same app catalog + launch actions
```

## Ownership

| Concern | Owner |
|---|---|
| App definition, translated name/description, launch action | shared `createMiniApps` catalog |
| Fixed Home card grid and bottom-pinned Open action | shared Home `MiniApp` renderer mounted by Maestro local Home |
| Compact Apps list | Maestro Workbench Apps renderer |
| Singleton creation/focus and authentication cleanup | main-process window handler |
| Renderer/preload entry registration | Bitterless electron-vite configuration |
| App update, quit, application menu, signing, installer | Bitterless host |
| Sub-application UI, local state, and domain services | sub-application |
| Cross-process calls | narrow XPC launch contracts; sender-checked IPC for privileged local renderers |

## Modules

- [Renderer language coordination](renderer-i18n.md)
- [OnlyPreview sub-application](onlypreview.md)
- [Maestro sub-application](maestro.md)
- [Coin sub-application](coin.md)
- [Coin layout](coin-layout.md)

## Fixed Home Mini Apps card layout

The shared fixed-Home grid uses one constant card geometry so copy length never changes the action
baseline. Workbench Apps intentionally keeps its independent compact list.

```text
320 × 184px card
┌──────────────────────────────┐
│ icon  title                  │
├──────────────────────────────┤
│ description · max 3 lines    │
│ flexible remaining space     │
│                       [Open] │
└──────────────────────────────┘
```

- Card body layout is vertical; actions are pinned to the bottom padding.
- Description overflow is clipped after three lines and cannot resize the card.
- Loading/disabled changes only the existing Open control state, never card geometry.
- The shared component is the single styling owner for Maestro fixed Home; Workbench does not copy
  or inherit this card stylesheet.

## Scope-wide constraints

- Both Mini Apps discovery surfaces open independent singleton windows; the app surfaces are not
  hidden routes inside either discovery renderer. A documented Omni adapter may render a compatible
  sub-application directly inside a cell. OnlyPreview explicitly has no Omni adapter because it owns
  a multi-view native window graph.
- All windows have a minimum usable size of `800x600`.
- Home launch and non-privileged cross-process boundaries use `electron-xpc`. Filesystem access
  through XPC must use Main-issued capabilities because generic XPC does not preserve sender
  identity. A local renderer that needs strict privileged sender identity may use a narrow
  `contextBridge` plus sender-checked `ipcMain`; Coin uses this exception.
- Every first-party UI renderer initializes its locale from the main process before Vue mount and
  follows committed Home language changes while alive.
- Arbitrary web pages never receive a privileged Bitterless or Maestro preload.
- Host-level lifecycle services must not be duplicated by an embedded sub-application.
