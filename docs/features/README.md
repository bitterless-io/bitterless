# Desktop Sub-applications

## Purpose and boundary

This scope owns independently rendered desktop work surfaces opened from Bitterless **Mini Apps**.
The Bitterless home renderer owns discovery and launch. Each sub-application owns its window-local
UI and domain runtime, while the Bitterless main process owns the Electron application lifecycle,
authentication invalidation, updates, packaging, and final cleanup.

```text
Bitterless Home / Mini Apps
            |
            +---- TodoWindowHandler ---- Todo BrowserWindow
            |
            +---- CoworkWindowHandler -- Cowork BrowserWindow graph
```

## Ownership

| Concern | Owner |
|---|---|
| Mini App card, translated name/description, Open action | Bitterless home renderer |
| Singleton creation/focus and authentication cleanup | main-process window handler |
| Renderer/preload entry registration | Bitterless electron-vite configuration |
| App update, quit, application menu, signing, installer | Bitterless host |
| Sub-application UI, local state, and domain services | sub-application |
| Cross-process calls | `electron-xpc` contracts |

## Modules

- [Cowork sub-application](cowork-subapp.md)

## Scope-wide constraints

- Mini Apps open as independent singleton windows; they are not hidden routes inside the home
  renderer.
- All windows have a minimum usable size of `800x600`.
- Renderer, preload, and main-process boundaries communicate through `electron-xpc`.
- Arbitrary web pages never receive a privileged Bitterless or Cowork preload.
- Host-level lifecycle services must not be duplicated by an embedded sub-application.
