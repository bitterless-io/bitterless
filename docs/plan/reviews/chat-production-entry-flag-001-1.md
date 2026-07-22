---
id: chat-production-entry-flag-001-1
task: chat-production-entry-flag-001
---

# Chat Production Entry Flag Review

## Scope

Independent source/static verification of `docs/plan/tasks/chat-production-entry-flag-001.md` against
`docs/features/chat-entry-visibility.md`. Runtime, UI, and E2E checks were intentionally excluded;
Ral owns runtime verification for this task.

## Evidence

- `src/renderer/home/src/router/defaultRoutes.ts:6-7,9-17,73-80` derives both root and catch-all
  destinations from `VITE_ENV === 'dev'`, retains the statically registered Chat route, and sends
  every non-dev build to Mini Apps.
- `src/renderer/home/src/views/layout/components/homeMenu/HomeMenu.vue:13-29,45-47` filters only the
  Chat menu item through the reactive singleton and loads its persisted override without invoking
  the full General loader.
- `src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts:20-33,49-92`
  uses `key=general`, `sub_key=showChatMenu`, accepts only a boolean read value, deduplicates
  concurrent loads, applies an optimistic reactive update, serializes saves, and restores the
  previous value when persistence rejects.
- `src/preload/sqlite/dao/setting.dao.ts:11-41` confirms the existing XPC `SettingDao` JSON-parses
  reads and performs a parameterized SQLite upsert; both invoked handler methods take one parameter.
- `src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue:23-41,81-83`
  exposes a loading/disabled switch bound to the shared state.
- `src/renderer/common/i18n/en.ts:87-92` and `src/renderer/common/i18n/zh.ts:88-93` provide matching
  English and Chinese labels, descriptions, and failed-save messages.
- `src/renderer/common/i18n/rendererLanguage.ts:68-75,78-84` shows why importing the General store
  from HomeMenu is safe: the top-level listener registration does not access the guarded language
  snapshot. Only `loadSettings()` calls `getCurrentRendererLanguage`; the HomeMenu path calls the
  isolated `loadChatMenuVisibility()` method.

## Checks

- Non-dev default hidden: pass. The initial singleton value is `false` for every value other than
  exact `dev`, before asynchronous SQLite loading can affect the first menu render.
- Dev default visible: pass. Both route landing and visibility default use the same exact
  `VITE_ENV === 'dev'` predicate.
- Root/catch-all landing: pass. Both redirect to Chat in dev and Mini Apps otherwise.
- Direct Chat access: pass. The route remains in `baseRoutes`; only its top-level menu item is
  filtered.
- SQLite boolean persistence and malformed/read-failure fallback: pass. Missing, malformed JSON,
  non-boolean JSON, and rejected reads all leave the environment default unchanged.
- Reactive cross-component update and failed-save rollback: pass. HomeMenu and General share one
  reactive singleton; save re-entry is blocked and a rejection restores the captured prior value
  with a localized message.
- Concurrency/XPC: pass. Concurrent initial loads share one promise, the switch is disabled while
  loading or saving, and the existing one-argument XPC DAO contract is respected.
- Language initialization boundary: pass. HomeMenu's load path does not call the guarded language
  getter.
- `git diff --check`: pass for the complete dirty worktree.
- Targeted ESLint on the seven implementation/i18n files: exit 0 with no errors. Prettier warnings
  remain in already broadly unformatted files, including a few touched lines; none changes the
  feature contract.
- `yarn typecheck:web`: the project-wide command remains red on unrelated existing/concurrent
  Connector, Coin, Poker, Chat, Omni, Translator, and other diagnostics. It reported no diagnostic
  in any Chat visibility task implementation file.

## Findings

No P1, P2, or P3 finding was identified in the reviewed scope.

## Conclusion

**Pass.** The implementation satisfies the production/dev defaults, landing behavior, durable
boolean override, reactive switch/rollback, localization, concurrency, XPC, and language-bootstrap
contracts. Runtime behavior remains for Ral to verify as explicitly scoped by the task.
