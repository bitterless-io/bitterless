# Renderer I18n Synchronization Analysis

## Goal

Make the Bitterless main process the runtime language authority, initialize every first-party UI
renderer from it before Vue mount, and broadcast committed language changes from Home Settings to
all live renderer contexts.

## Module decomposition

| Module | Input | Output | Dependencies |
|---|---|---|---|
| Durable language adapter | stored core SQLite language or system locale on first run | validated `en` / `zh` | hidden core SQLite renderer |
| Main language service/handler | startup read and Home set request | current language, persistence, main i18n update | durable adapter, tray, `xpcMain` |
| Shared renderer bootstrap | main handler response and language broadcasts | reactive messages, Vue locale, document `lang` | renderer i18n helper, `electron-xpc` |
| Renderer entries | shared bootstrap completion | correctly initialized Vue application | Home, Todo, Connector, Omni, Maestro entries |
| Home language setting | user radio selection | typed main-process set request | main language handler |
| Verification | source graph and Electron runtime | initialization/broadcast/recreate evidence | build and E2E harnesses |

## Integration enumeration

| Caller | Callee | Required evidence |
|---|---|---|
| application startup | durable language adapter | read completes before Home creation |
| application startup | main language service | main dialogs/tray share persisted value |
| every UI renderer entry | main language handler | current value is awaited before Vue mount |
| Home Settings | main language handler | value persists before runtime update/broadcast |
| main language handler | all live renderers | one authoritative broadcast updates every locale |
| recreated Todo/Omni/Maestro renderer | main language handler | recreated UI starts in current language without a new broadcast |

## Risks

| Risk | Control |
|---|---|
| renderer-local storage diverges by partition | remove renderer-local detection from runtime initialization |
| broadcast is missed while a window is destroyed | mandatory main-process fetch before each mount |
| initial English frame flashes before persisted Chinese loads | do not mount Vue until bootstrap resolves |
| failed persistence appears successful | persist first; update/broadcast only after success |
| one renderer entry is omitted | explicit entry inventory plus source guard |
| hidden/third-party pages gain privileged language APIs | scope bootstrap only to first-party Vue entries |

## Delivery

One task owns the typed contract, main authority, shared renderer bootstrap, all entry wiring, and
integration verification because these boundaries are not independently useful until connected.
