---
id: maestro-local-home-navigation-007
scope: fixed Maestro Home tab Mini Apps, Connector, and Settings workspace
status: implemented; owner verification pending
depends-on: [maestro-cowork-menubar-parity-006]
verify: source audit and independent review only; Ral owns Electron/runtime visual acceptance
---

# Replace the fixed Home chat with the Bitterless Home workspace

## Objective

Make the fixed `bitterless://home` tab open the existing Bitterless Mini Apps workspace instead of
Chat. Restore the familiar 56px left navigation for Mini Apps, Connector, and Settings without
mounting the authenticated Home shell or duplicating connector runtime ownership.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-local-home-still-shows-chat.md`
- `docs/features/chat-entry-visibility.md`
- `docs/plan/tasks/maestro-cowork-menubar-parity-006.md`
- `docs/plan/tasks/maestro-main-shell-004.md`

## Path

- `src/renderer/maestro/localHome/**`
- `src/renderer/home/src/views/miniApp/MiniApp.vue`
- `src/renderer/home/src/views/layout/components/homeMenu/**`
- `src/renderer/home/src/views/setting/**` (reuse; edit only for explicit local-surface behavior)
- `src/renderer/home/src/views/connector/**` (ownership audit only; no local import or edit)
- `src/preload/maestro/{localHome.preload.ts,workbench.preload.ts}` (ownership audit; avoid duplicate
  connector registration)
- `docs/features/maestro.md`
- `docs/issues/maestro-local-home-still-shows-chat.md`
- `docs/plan/{README.md,tasks, reviews}/**`
- `docs/INDEX.md`

## Contract

- The local renderer owns this exact layout and reuses Bitterless's existing quiet Royal Blue/white
  visual system; this is a component reuse, not a redesign:

  ```text
  ┌─ local Home · full operation bounds ────────────────────────────────┐
  │ ┌─ rail 56 ─┬─ route content · min-width/min-height 0 ────────────┐ │
  │ │ Mini Apps │ cards; default route                               │ │
  │ │ Connector │ opens the existing Workbench Connector pane        │ │
  │ │           │                                                     │ │
  │ │ Settings  │ existing nested Settings navigation/content        │ │
  │ └───────────┴─────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
  ```

- Use a dedicated local hash router with exactly two content routes: `mini-app` and `setting`.
  Unknown routes redirect to Mini Apps. Use `keep-alive` so route switching does not discard page
  state. Connector is a rail action, not a local content route.
- The rail uses the existing Home menu icons, 48px controls, selected treatment, 12px rhythm, and
  56px sider. It exposes localized title/ARIA labels and keeps Settings in the footer.
- Remove Chat, MessageSearch, their keyboard shortcut, Markdown/KaTeX bootstrap, and the local
  surface marker that existed only to suppress MessageSearch's Home-router import.
- Reuse `MiniApp.vue` and `Setting.vue`; do not import `Connector.vue`, `Layout.vue`, `HomeMenu.vue`,
  the normal Home router/default routes, `App.vue`, Login, Home MenuBar, or Home entry
  initialization.
- Decouple `MiniApp.vue` from `authStore`: Todo opens through `homeShellBridge.openTodo()`, retaining
  the hidden Home renderer as the sole customer-session and Todo-readiness authority.
- Keep Workbench as the sole WeChat/DingTalk/Feishu connector runtime and renderer-handler owner.
  The local Connector rail action calls the existing Workbench pane command; it must not import or
  mount `Connector.vue`, and must not import `connector.preload` into the local Home preload.
- When Settings is mounted, load the initially selected Proxy pane just as the normal Home entry
  does. Hide the legacy `Show Chat menu` control only on this no-Chat local surface through an
  explicit component prop; preserve the shared setting and the normal Home/Workbench contracts.
- Preserve shared renderer-language initialization and live updates before Vue mounts. No visible
  local label may be hard-coded outside the existing localized page copy or the shared
  `maestroWorkbench.panes` labels.
- Preserve the pinned Home view's XPC-only preload, Maestro partition, `bitterless://home` display
  address, navigation confinement, and non-recordable/non-debuggable behavior. Ordinary browser
  tabs receive no first-party preload.
- Preserve Workbench Apps/Connectors/Settings, Control chat, ordinary browser tabs, AI-CRMS login,
  and all Maestro window/chrome behavior outside the fixed Home content.

## Verification

- Independent source review verifies the local import graph, exact two-route/three-action menu
  structure, Home component reuse, Todo bridge ownership, connector handler uniqueness, i18n, and
  absence of Chat/auth/update/shell imports.
- Task-owned `git diff --check` and new-file trailing-whitespace inspection must pass.
- Do not run tests, type checks, lint, builds, Electron, Playwright/E2E, network, or packaged-app
  smoke in this delivery. Ral owns real-app acceptance.

## Delivery

- Implemented on 2026-08-26.
- Added a dedicated local hash router and 56px Home rail. Mini Apps is the deterministic content
  default, Settings remains local, and Connector opens the existing Workbench pane.
- Removed the fixed Home Chat/Search bootstrap and kept connector runtime/renderer handler ownership
  exclusive to Workbench.
- Decoupled the shared Mini Apps Todo launcher from renderer-local auth, initialized the default
  Proxy settings pane, and hid the legacy Chat-menu control only on this local no-Chat surface.
- Independent source review: [Review 1](../reviews/maestro-local-home-navigation-007-1.md) —
  Approved, no P0-P2 findings.
- Ral owns Electron/runtime visual and E2E acceptance; intentionally not run in this delivery.
