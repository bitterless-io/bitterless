# Maestro fixed Home tab still shows Chat instead of the Home workspace

Status: implemented; owner verification pending

## Observed behavior

The fixed `bitterless://home` tab currently mounts `Chat.vue` and `MessageSearch.vue` directly. It
therefore opens as a second chat surface beside Maestro Control and omits the Bitterless Home
navigation that Ral expects to use for Mini Apps, Connectors, and Settings.

## Required behavior

```text
┌─ fixed Home operation surface ─────────────────────────────────────────┐
│ ┌─ 56px rail ─┬──────────────────────────────────────────────────────┐ │
│ │ Mini Apps ● │ Mini Apps grid (default)                            │ │
│ │ Connector   │ opens the existing Workbench Connector pane        │ │
│ │             │                                                      │ │
│ │             │ local Settings route remains available internally   │ │
│ │             │ but has no left-rail button                         │ │
│ └─────────────┴──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

- Remove Chat and MessageSearch from the fixed local Home renderer.
- Reuse the existing Home Mini Apps, Connector, Settings, 56px rail, icons, selected state, and
  content styles. Mini Apps is the deterministic default route. The local Settings route remains
  available internally, but its left-rail footer button is hidden.
- Register only `mini-app` and `setting` as content routes in a local no-auth router. Connector is a
  third rail action that opens the existing Workbench Connector pane. Do not import the normal Home
  router, Login, Chat, MessageSearch, Home MenuBar, update/proxy polling, Todo/session subscribers,
  or the Chat-visibility menu store.
- The Mini Apps Todo action delegates to the hidden authenticated Home shell through
  `HomeShellBridgeHandler`; the local renderer must not instantiate `authStore` or copy customer
  credentials into the Maestro partition.
- The always-live Workbench remains the sole owner of WeChat, DingTalk, and Feishu connector
  runtimes and renderer handlers. The local Home must not mount `Connector.vue` or register a
  second connector runtime/handler set.
- Settings loads its initially selected Proxy pane and does not expose the legacy `Show Chat menu`
  control on this no-Chat surface.
- Preserve the dedicated XPC-only local preload, Maestro partition, fixed display URL, navigation
  confinement, i18n initialization, pinned/non-recordable/non-debuggable rules, and the existing
  Workbench Apps/Connectors/Settings panes.

## Acceptance

- Opening or recreating Maestro shows Mini Apps inside the fixed Home tab, never Chat or New Chat.
- The left rail contains only Mini Apps and Connector. The local Settings route remains registered
  without a visible rail entry; Connector opens the existing Workbench pane.
- The pinned Home tab favicon and the blank New-tab splash use the Bitterless application icon,
  not Maestro's blue `M` logo. The generic icon for arbitrary web tabs is unchanged.
- Source inspection proves the local entry has no Chat, MessageSearch, Home router/auth/login, or
  duplicate connector-preload import.
- Ral verifies Mini App open actions, the Workbench Connector pane, Settings operations, and layout
  in the real Electron window.

Implementation task: [maestro-local-home-navigation-007](../plan/tasks/maestro-local-home-navigation-007.md).
Brand/menu follow-up: [maestro-local-home-branding-008](../plan/tasks/maestro-local-home-branding-008.md).
