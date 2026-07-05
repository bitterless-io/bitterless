---
status: completed
depends-on: []
verify:
  - renderer-only Vite build for home and todo entries
  - yarn install --frozen-lockfile --ignore-scripts
  - no renderer Arco icon imports remain
---

# Use Tabler Icons

## Goal

Replace renderer component icon usage from Arco icon components to Tabler Vue icon components.

## Scope

- Add `@tabler/icons-vue` to the workspace root.
- Replace direct imports from `@arco-design/web-vue/es/icon` in Vue renderer files.
- Preserve existing image asset based menu icons and app/tray icons.
- Keep current button, tooltip, modal, and layout behavior unchanged.

## Verification

- Passed a renderer-only Vite build for the affected `home` and `todo` entries.
- Passed `yarn install --frozen-lockfile --ignore-scripts`.
- Confirmed no renderer Vue files still import `@arco-design/web-vue/es/icon`.
- `yarn typecheck:web` is currently blocked by existing unrelated type errors in connector handlers, i18n, poker tests, XPC aliases, chat store types, and todo throttling options.
