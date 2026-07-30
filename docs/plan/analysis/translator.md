# Translator Delivery Analysis

## Module Decomposition

| Module | Inputs | Outputs | Dependencies | Task |
|---|---|---|---|---|
| shared model-provider contract | XPC values and persisted records | strict provider snapshots and events | none | translator-miniapp-001 |
| Main model-provider service | Codex credential state, runtime auth results | SQLite record, available targets, broadcasts | `SettingDao`, `CodexCredentialService` | translator-miniapp-001 |
| Codex runtime auth classifier | Pi session errors and thrown errors | typed auth-required reason or generic provider failure | sterile Codex runtime | translator-miniapp-001 |
| Home Model Config | provider snapshot and login actions | provider-first status UI | ModelProvider XPC | translator-miniapp-001 |
| Translator service | bounded source text and client/request IDs | validated translation or typed error | provider service, Codex runtime, Zod | translator-miniapp-001 |
| Translator renderer | text input, provider broadcasts | result canvas and login/composer states | Translator + ModelProvider XPC | translator-miniapp-001 |
| Omni runtime mapping | persisted `miniAppId=translator` | privileged translator operation view | preload/renderer build outputs | translator-miniapp-001 |

## Integration Enumeration

1. `ModelProviderHandler` creates/calls the singleton model-provider service.
2. The provider service calls the hidden SQLite `SettingDao` through XPC, calls the shared Codex
   credential service, and broadcasts every persisted state transition.
3. Home Model Config and every Translator renderer subscribe before fetching their first snapshot,
   preventing a login completion broadcast from being lost between mount and read.
4. Login from either renderer calls the same handler. The handler persists `authenticating`, then
   `ready` or failure, and broadcasts both; neither renderer owns optimistic credential state.
   Other Main-process consumers of the shared Codex credential singleton publish value-free
   successful-login/logout transitions into the same registry; auth-file observation alone cannot
   clear `invalidated`.
5. `TranslatorHandler` calls the Translator service. The service checks the provider snapshot,
   calls the shared sterile Codex runtime with fixed `gpt-5.6-luna/low`, validates output, and reports a
   successful or auth-required runtime observation back to the provider service.
6. Runtime auth invalidation persists before the translation reply returns, so both renderers show
   Login even when the on-disk OAuth record still exists.
7. Omni control persists `translator`; Main resolves it through an explicit allowlisted registry,
   creates the translator preload/renderer view, and applies the same privileged navigation fence
   as other first-party mini apps.
8. Electron Vite emits `out/preload/translator.js` and
   `out/renderer/translator/index.html`; the renderer-language inventory includes Translator.

## Delivery Order

```text
contracts + provider persistence
  -> runtime auth classification + provider handler
  -> Home Model Config
  -> Translator service + renderer
  -> Omni/build/i18n integration
  -> independent source review + Node/Web static checks
```

All implementation remains one serial task because provider events, shared i18n, the Home Model
Config, and Translator behavior form one user-observable login/translation path.
