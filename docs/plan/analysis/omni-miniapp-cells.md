# Omni Mini-App Cells Delivery Analysis

## Module Decomposition

| Module | Inputs | Outputs | Dependencies |
|---|---|---|---|
| Shared cell contract | persisted/renderer leaf data | normalized browser or mini-app cell | existing `OmniPaneNode` tree |
| Layout control | per-pane mode, URL, mini-app selection | flattened cells + persisted tree | Arco, layout store, XPC |
| Omni main runtime | flattened cell config | cell chrome + operation `WebContentsView` | Electron, runtime target registry |
| Mini-app runtime registry | app ID, app path, dev server URL | preload plus dev/file renderer target | Todo/EyesOnAgents/Translator/Motto build entries |
| Embedded EyesOnAgents context | static host argument | standalone-action visibility | context bridge, renderer menu bar |
| Persistence | complete normalized tree | restored cells after reopening Omni | `SettingDao.omni_layout` |

## Integration Enumeration

1. Layout panel creates a mode/app mutation through `layout.store`, then sends both the flattened
   cell list and full tree through `OmniWindowHandler.updateLayout`.
2. `OmniWindowHelper` compares the old and new runtime signature. A changed mode/app recreates the
   operation view using the real runtime registry.
3. Browser targets retain the current `persist:omni` session, remote-content preload, navigation,
   notification, and URL-persistence path.
4. Todo targets load the real Todo renderer with the real Todo preload and existing non-standalone
   renderer behavior.
5. Todo and EyesOnAgents targets load the real renderer/preload. Static host context prevents
   window-only behavior, gives embedded Todo a store-local refresh path, and removes standalone
   chrome/minimum-size assumptions.
6. `SettingDao.omni_layout` saves mode and app selection with the tree; reopen restoration goes
   through the same normalization and runtime creation path as live edits.
7. Electron Vite continues to produce Todo, EyesOnAgents, Translator, and Motto renderer/preload
   entries; runtime path tests and a full build verify the dev URL and packaged file branches.
8. Privileged mini-app operation views reject navigation outside their expected local renderer;
   external links leave through the system browser and remote browser cells never inherit a
   first-party preload.
9. OnlyPreview is absent from the shared allowlist, runtime registry, and Control selector. A
   persisted `onlypreview` value fails through the same explicit unsupported-app recovery path as
   any unknown ID because OnlyPreview owns a standalone native window graph.

## Task Boundary

The shared contract, UI, runtime selection, embedded host behavior, and persistence form one
observable feature. Splitting them would leave temporary states where persisted cells cannot render
or the UI can select a target the main process cannot create, so they are delivered as one serial
task.

The task starts after `eyes-on-agents-focus-002` because both modify EyesOnAgents menu/runtime
surfaces and shared locale files. This preserves that task's uncommitted lifecycle work and gives
the embedded renderer the final connection contract.
