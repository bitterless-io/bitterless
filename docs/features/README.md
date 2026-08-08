# Desktop Sub-applications

## Purpose and boundary

This scope owns independently rendered desktop work surfaces opened from Bitterless **Mini Apps**.
The Bitterless home renderer owns discovery and launch. Each sub-application owns its window-local
UI and domain runtime, while the Bitterless main process owns the Electron application lifecycle,
authentication invalidation, updates, packaging, and final cleanup.

Maestro and Coin remain integrated runtimes, but their Home Mini Apps cards and launch actions are
temporarily hidden. Todo, EyesOnAgents, OnlyPreview, and Omni Browser remain visible. Hiding these
two entries does not remove their window handlers, renderer entries, packaged resources, or
persisted data.

```text
Bitterless Home / Mini Apps
            |
            +---- TodoWindowHandler ---- Todo BrowserWindow
            |
            +---- OnlyPreviewHandler --- OnlyPreview BaseWindow + Setting window
            |
            +---- MaestroWindowHandler -- Maestro BrowserWindow graph (entry dormant)
            |
            +---- CoinWindowHandler ----- Coin BrowserWindow (entry dormant)
```

## Ownership

| Concern | Owner |
|---|---|
| Mini App card, translated name/description, Open action | Bitterless home renderer |
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

## Scope-wide constraints

- Mini Apps open as independent singleton windows; they are not hidden routes inside the home
  renderer. A documented Omni adapter may render a compatible sub-application directly inside a
  cell. OnlyPreview explicitly has no Omni adapter because it owns a multi-view native window graph.
- All windows have a minimum usable size of `800x600`.
- Home launch and non-privileged cross-process boundaries use `electron-xpc`. Filesystem access
  through XPC must use Main-issued capabilities because generic XPC does not preserve sender
  identity. A local renderer that needs strict privileged sender identity may use a narrow
  `contextBridge` plus sender-checked `ipcMain`; Coin uses this exception.
- Every first-party UI renderer initializes its locale from the main process before Vue mount and
  follows committed Home language changes while alive.
- Arbitrary web pages never receive a privileged Bitterless or Maestro preload.
- Host-level lifecycle services must not be duplicated by an embedded sub-application.
