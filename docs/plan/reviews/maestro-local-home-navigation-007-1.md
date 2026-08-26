# maestro-local-home-navigation-007 — Review 1

- Date: 2026-08-26
- Scope: independent review of the current-worktree implementation owned by
  `maestro-local-home-navigation-007`, plus the existing fixed-Home, Workbench, connector, and
  hidden-Home boundaries needed to verify isolation. Unrelated OnlyPreview documentation changes
  were excluded.
- Method: source inspection only. Per task contract, no tests, typecheck, lint, build, Electron,
  Playwright/E2E, network, or packaged-app smoke was run.

## Findings

No P0-P2 findings.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Mini Apps is deterministic at startup; only Mini Apps and Settings are local content routes | `src/renderer/maestro/localHome/src/localHome.router.ts:1-20` defines a dedicated hash router, redirects both `/` and unknown paths to `/mini-app`, and registers only the `mini-app` and `setting` content components | pass |
| Three rail actions with Connector delegated to Workbench | `src/renderer/maestro/localHome/src/components/LocalHomeMenu.vue:10-16,22-61` routes Mini Apps and Settings locally while Connector calls only `workbenchStore.openPane('connectors')`; `src/renderer/maestro/home/src/store/workbench.store.ts:27-31` shows that command opens Workbench then broadcasts its pane | pass |
| Existing 56px Home geometry and route-state retention | `src/renderer/maestro/localHome/src/LocalHomeApp.vue:6-23` owns the 56px sider, constrained content area, and `keep-alive`; `src/renderer/maestro/localHome/src/localHome.less:1-76` reproduces the existing 48px controls, 12px rail rhythm, footer placement, and overflow constraints from the Home layout | pass |
| Chat/Search and their renderer bootstrap are absent | `src/renderer/maestro/localHome/src/LocalHomeApp.vue:1-25` mounts only the menu and routed content; `src/renderer/maestro/localHome/src/main.ts:1-18` contains no Chat, MessageSearch shortcut, markstream, KaTeX, Monaco setup, or surface marker and still initializes language before Vue mount | pass |
| Connector runtime and renderer-handler ownership stays unique | `src/preload/maestro/localHome.preload.ts:1-3` remains XPC-only; `src/preload/maestro/workbench.preload.ts:1-4` remains the sole Maestro preload importing `connector.preload`; the local router/menu do not import `Connector.vue`. Workbench alone imports it through `src/renderer/maestro/workbench/src/views/WorkbenchConnectorsView.vue:1-9`, which is where the WeChat/DingTalk/Feishu renderer-handler graph remains rooted | pass |
| Todo remains authenticated by the hidden Home shell | `src/renderer/home/src/views/miniApp/MiniApp.vue:39-56` replaces direct `authStore`/Todo-emitter ownership with `homeShellBridge.openTodo()`; `src/renderer/common/homeShellBridge.client.ts:31-43` delegates readiness and opening through `HomeShellBridgeHandler` | pass |
| Settings loads Proxy initially and hides Chat visibility only in local Home | `src/renderer/home/src/views/setting/Setting.vue:55-65,86-105` keeps the shared Settings implementation, loads Proxy when its default tab mounts, and defaults the new prop to visible; `src/renderer/maestro/localHome/src/localHome.router.ts:8-13` passes `false` only on the local route; `src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue:23-45,73-80` scopes the hidden control to that prop | pass |
| Local labels and controls are localized and keyboard reachable | `src/renderer/maestro/localHome/src/components/LocalHomeMenu.vue:22-61` uses existing `maestroWorkbench.panes` labels for title and ARIA text, provides button roles/tab stops, and supports Enter and Space for every rail action; the reused Mini Apps and Settings pages already source visible copy from `i18nHelper` | pass |
| Fixed Home security and browser-tab isolation are unchanged | The task does not alter the main fixed-view lifecycle. `src/main/maestro/windows/main/maestroBrowserView.service.ts:405-419,438-447,734-771,826-829` still supplies the dedicated preload/partition, confines hash navigation to the local entry, masks the display URL, and keeps the pinned Home separate from ordinary browser-tab capture/debugger behavior | pass |
| Workbench and ordinary Home behavior remain compatible | `Setting.vue` and `GeneralSetting.vue` default `showChatMenuControl` to `true`, so existing callers retain the control; Connector remains mounted only by Workbench; no Workbench route/preload or fixed-Home main-window code changed in this task | pass |

## Conclusion

**Approved — no P0-P2 findings.**

The fixed Home renderer now opens the existing Mini Apps content with the familiar rail, delegates
Connector to the single Workbench owner, and keeps Settings local without retaining a second Chat
surface or expanding preload privileges. Ral's Electron/runtime visual and E2E acceptance remains
intentionally unrun and is the delivery handoff.
