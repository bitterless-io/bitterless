# Renderer Language Coordination

Status: Current delivery contract

## Purpose

Bitterless owns one application language across every first-party renderer UI. The Home settings
surface is the only user-facing language control, the main process owns the current runtime value,
and every renderer must initialize from that value before its first Vue mount.

This contract covers language configuration and synchronization. Existing product copy is translated
when it already uses the shared message schema; migrating every remaining hard-coded Maestro string
is a separate localization delivery.

## Renderer scope

| Renderer entry | UI role | Required |
|---|---|---|
| `home` | Bitterless Home and Settings | i18n plugin, initial language fetch, live updates |
| `todo` | embedded and standalone Todo | i18n plugin, initial language fetch, live updates |
| `connector` | first-party connector window | i18n plugin, initial language fetch, live updates |
| `omniWindow` | Omni shell | i18n plugin, initial language fetch, live updates |
| `omniControl` | Omni layout controls | i18n plugin, initial language fetch, live updates |
| `omniCell` | Omni cell chrome | i18n plugin, initial language fetch, live updates |
| `maestroHome` | Maestro browser chrome | i18n plugin, initial language fetch, live updates |
| `maestroControl` | Maestro chat/control | i18n plugin, initial language fetch, live updates |
| `maestroWorkbench` | Maestro Workbench | i18n plugin, initial language fetch, live updates |

Hidden SQLite renderers, the Llama worker surface, and arbitrary operation web pages do not mount
first-party product UI and are excluded from the Vue i18n plugin requirement.

## Ownership and flow

```text
core SQLite language persistence
             |
             | startup read
             v
main-process application language service
      |                         ^
      | get current language    | set language from Home Settings
      v                         |
renderer bootstrap         Home renderer
      |
      | subscribe before mount
      v
Vue app mounts with the correct locale

main language change -- broadcast --> every live first-party renderer
```

- The core SQLite language record remains the durable source across application restarts.
- The main process validates the stored value and owns the current in-memory language after startup.
- Immediately after starting the Core SQLite renderer, main publishes a system-language in-memory
  fallback so Home and other independent renderers can mount without waiting for persistence.
  Successful Core readiness then hydrates the durable language and broadcasts any change.
- Home Settings requests a change through a typed main-process handler. The main process persists
  the value before updating its own dialogs/tray and broadcasting the committed language.
- Renderers never broadcast authoritative language changes and never use renderer-local
  `localStorage` or `navigator.language` as their runtime source of truth.

## Initialization contract

Every in-scope renderer must:

1. register the shared language-change subscriber;
2. request the current language from the main process;
3. apply it to the shared reactive messages, Vue i18n locale, and document `lang` attribute;
4. only then create and mount its Vue application.

A renderer destroyed before a broadcast and later recreated therefore obtains the current language
from main rather than relying on event history. Missing or invalid required language state is an
explicit initialization error; the renderer must not silently mount in a guessed/default locale.

## Live-change contract

- Only `en` and `zh` are accepted.
- A successful Home change updates all currently alive in-scope renderers without reload.
- A failed persistence write leaves the old runtime language active and emits no success broadcast.
- Main-process tray and dialog messages update from the same committed value.
- Duplicate delivery of the current language is idempotent.

## Verification

- A deterministic source guard enumerates every in-scope renderer entry and proves that it awaits
  shared language initialization before mounting and installs the Vue i18n plugin.
- Contract tests cover invalid values, persistence-before-broadcast ordering, and renderer startup.
- Electron E2E changes language from Home, observes live renderer updates, destroys/recreates a
  sub-application window, and observes the committed language before its first rendered state.
- Existing renderer, build, Todo, Omni, and Maestro gates remain green.
