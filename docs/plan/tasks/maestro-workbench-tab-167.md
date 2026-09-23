---
id: maestro-workbench-tab-167
scope: BL Workbench tab interaction matching Cowork
status: implemented; owner testing pending
depends-on: []
verify: native-boundary lifecycle tests, MenuBar compilation and focused regressions
---

# Workbench tab

Ral requests BL's Workbench to open as a browser tab like Cowork, and removes the settings gear's
selected state. Reference: Cowork docs/features/workbench-tab.md. The existing BL tab palette,
system font and IconBtn controls remain; a fixed 132px Workbench chip follows the pinned group.

- Gear opens/focuses one tab; clicking it again does not close it. No filled icon or aria-pressed.
- Main owns open/visible separately. Clicking a web/mini-app tab backgrounds Workbench but leaves
  its chip; chip X, Workbench X and Cmd+W close it. User New tab backgrounds it too.
- 2026-09-23 addendum (Cowork `workbench-tab.md` #5 exception): a display the user explicitly asked
  for also backgrounds Workbench first — `activate_tab`/`open_tab` with `show: true`, the chat's
  "view this tab" (`showAgentBrowserTab`), and in BL additionally every OnlyPreview open that lands
  on the tab mount (`openWorkspaceInPreview`: MCP `preview_open` and the chat workspace chip) and
  every operator app-open (`openCompositeTab`: Workbench Apps, Zellij, Trench, OnlyPreview
  window→tab). `activateTab()` itself is unchanged, so drill and `show=false` activations still leave
  Workbench alone. See `docs/issues/agent-show-tab-hidden-behind-workbench.md`.
- The native Workbench renderer survives tab close, keeping recording state; only window teardown
  destroys it. Geometry still follows the operation rect. Agent tab activation stays independent.
- Foreground address is bitterless://workbench. Address/back/forward/reload are disabled without
  changing the browser target or URL. Internal bitterless/micromeet Workbench URLs open the singleton.
- Restart does not restore Workbench. Existing pane-open entry points open this same tab.

Human check after loading these changes: open/reopen gear, switch web/OnlyPreview tabs, close via
both X buttons/Cmd+W, reopen with Capture state retained, and use +/Cmd+T. No Electron/E2E,
release/install or Git sync is performed by this task.

Verification: the combined BL lifecycle/layout, Workbench/MenuBar, workspace UI, provider,
composite navigation and auth-landing suites pass 39/39; Cowork workspace/Tooltip suites pass 6/6.
SFC/script/Less compilation and diff checks pass. Main and renderer/maestro type checks report
70 existing diagnostics outside the changed logic (including browser event.isMainFrame); scoped
source lint reports two existing unused AgentConversationContext imports in controller/handler.
Focused test lint passes. No independent review or live-app/E2E was run.
