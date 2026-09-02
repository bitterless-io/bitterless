# Motto Delivery Analysis

## Module Decomposition

| Module | Inputs | Outputs | Dependencies | Task |
|---|---|---|---|---|
| Motto storage service | browser `Storage`, whole JSON value | validated ordered items or typed storage failure | Web Storage API | motto-miniapp-001 |
| Motto renderer store | add/inline-edit/delete/reorder intent | reactive ordered collection, one inline draft, persistence errors | Motto storage service | motto-miniapp-001, motto-inline-edit-reorder-116 |
| Motto renderer | store state and shared language | header, draggable vertical cards, direct text editors, Delete menu, empty/error states | Vue, Arco, shared i18n, Vue Draggable | motto-miniapp-001, motto-inline-edit-reorder-116 |
| Omni mini-app registry | persisted `miniAppId=motto` | privileged Motto operation view | shared Omni parser, Main runtime mapping, Vite outputs | motto-miniapp-001 |

## Integration Enumeration

1. The Motto renderer store reads the complete storage value once during initialization and applies
   only validated items.
2. Add, inline edit, delete, and reorder create a complete next collection, ask the storage service
   to persist it, and commit reactive state only after that write succeeds. The blank Add card is a
   UI-only draft until its required Title is valid.
3. The Motto renderer initializes the shared application language before evaluating or mounting the
   product UI.
4. Omni Control exposes Motto from the shared mini-app ID contract and persists the selected leaf.
5. Main resolves `motto` to its dedicated preload and renderer and applies the existing privileged
   navigation fence.
6. Electron Vite emits `out/preload/motto.js` and `out/renderer/motto/index.html`; the renderer
   language inventory includes Motto.

## Delivery Order

```text
feature/layout contract
  -> storage service + mutation tests
  -> Motto renderer and shared i18n
  -> Omni/Main/Vite integration
  -> static, type, and build checks
```

This is one serial task because the shared mini-app union, runtime record, selector, and build
entries must change atomically for persisted layouts to remain valid.

The later inline-edit/reorder refinement is also one serial renderer task because its direct-edit
state, drag output, storage ordering, and interaction tests describe one user-visible card contract.
