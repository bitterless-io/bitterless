---
id: chat-production-entry-flag-001
scope: home
status: done
depends-on: []
---

# Objective

Hide the top-level Chat entry by default outside `VITE_ENV=dev`, expose a persisted General switch,
and make Mini Apps the normal production Home destination while retaining the existing Chat route.

# Context

- `docs/features/chat-entry-visibility.md`
- `docs/design/customer-authentication.md`

# Path

- `docs/features/chat-entry-visibility.md`
- `docs/design/customer-authentication.md`
- `src/renderer/home/src/router/defaultRoutes.ts`
- `src/renderer/home/src/views/layout/components/homeMenu/HomeMenu.vue`
- `src/renderer/home/src/views/setting/components/GeneralSetting/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`

# Verification

- Inspect environment defaults, boolean persistence, reactive menu updates, failed-save rollback,
  and localized General controls.
- Run the relevant Home renderer typecheck/static source checks only. Runtime verification is owned
  by Ral for this task.
