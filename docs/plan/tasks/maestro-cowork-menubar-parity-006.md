---
id: maestro-cowork-menubar-parity-006
scope: current Cowork MenuBar semantics, compact geometry, and a local fixed Home tab
status: implemented; owner verification pending
depends-on: [maestro-startup-chrome-005]
verify: source audit and independent review only; Ral owns Electron/runtime visual acceptance
---

# Complete the current Cowork MenuBar and local Home-tab migration

## Objective

Replace Maestro's stale debugger, recording, sidebar, and Workbench controls with the latest
compatible Micromeet Cowork behavior. Reduce the top strip and its tabs by 8px. Replace the remote
AI-CRMS fixed tab with Bitterless's bundled Home content without changing the 48px address row or
conflicting with Maestro-specific navigation, update, Demo, Control chat, and provider behavior.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-cowork-menubar-controls-outdated.md`
- `docs/plan/tasks/maestro-startup-chrome-005.md`
- `../micromeet-cowork/docs/features/recording-control.md`
- `../micromeet-cowork/docs/features/home-sidebar-toggle.md`
- Cowork source reference: `dev/next` commit `19b0621`

## Path

- `src/renderer/maestro/home/src/components/MenuBar/{MenuBar.vue,MenuBar.less}`
- `src/renderer/maestro/home/src/store/{layout.store.ts,capture.store.ts}`
- `src/renderer/maestro/control/src/{ControlApp.vue,ControlApp.less}`
- `src/renderer/maestro/control/src/ChatPanel.vue`
- `electron.vite.config.ts`
- `src/renderer/maestro/localHome/**`
- `src/preload/maestro/localHome.preload.ts`
- `src/renderer/home/src/views/chat/components/MessageSearch/messageSearch.store.ts`
- `src/main/maestro/auth/authBridge.ts`
- `src/main/maestro/windows/{window.helper.ts,main/maestroBrowserView.service.ts,main/maestroWindow.controller.ts}`
- `src/main/xpc/maestroWindow.handler.ts`
- `src/shared/maestro/{coach.api.ts,tabs.api.ts}`
- `src/renderer/common/i18n/{en.ts,zh.ts}`
- `docs/features/maestro-window-ioc.md`
- `docs/{features,issues,plan}/**`

## Contract

- Use 36/28/48/84px for top strip/tab/address/total chrome. Keep dark Omni colors, the 78px macOS
  gutter, traffic-light `x: 12`, and center the controls at `y: 10`.
- Hide the debugger button while retaining its store/XPC capability.
- Replace the capture toggle with a fixed 28px tab-row status slot. It is non-interactive, draws no
  idle dot, and draws the existing red pulse only while capture is active. Do not remove
  `captureStore.toggle()` or agent-owned start/stop tooling.
- Keep Snapshot visible only while recording when record actions are available.
- Use Sparkles/SparklesFilled for Control and Settings/SettingsFilled for Workbench. Their pressed
  state uses the shared blue active color without white background or shadow.
- Hide the duplicate Skills shortcut in the Control chat composer while retaining the Workbench
  Skills pane and its internal broadcast path.
- Add the Control-header close path with a `coach/sidebar-close` renderer broadcast. Home initializes
  one guarded subscriber and calls `closeSidebar()`; the existing MenuBar toggle remains the reopen
  path.
- Rename the fixed tab kind from `ai-crms` to `home`. Resolve its real local target as the dedicated
  `maestro/localHome` renderer and expose only `bitterless://home` to renderer chrome. Keep it
  pinned/non-closable/address-locked, block navigation outside the local entry, and disable
  recording/debugger use on it.
- The local entry mounts the existing Home `Chat.vue` and `MessageSearch.vue` with their required
  Arco/Markdown/KaTeX/theme/i18n bootstrap. It must not mount the Home or Maestro shell, router/login,
  side rail, or Home's singleton shell/update/auth/Todo subscribers.
- MessageSearch must not statically pull Home's router into the local renderer. Its result-click path
  skips routing on the explicitly marked local surface and dynamically loads the router only for the
  ordinary Home window.
- Use a dedicated XPC-only preload on the local Home view and retain the Maestro partition. Ordinary
  browser views keep their current unprivileged web preferences and never receive that preload.
- AI-CRMS provider/login is not a fixed-tab responsibility and must never navigate the fixed local
  Home tab. It uses one closable, non-persisted, non-recordable `ai-crms` tab whose ordinary
  no-preload view is confined to `crms.micromeet.ai`. Its startup order is about:blank renderer
  bootstrap, confirmed DebuggerCapture attach, authBridge attach, then trusted login navigation;
  closing, cooling, and window teardown detach the bridge before destroying its debugger/view.
- Auth session document-start injection applies only to the trusted login tab's main frame.
  Runtime binding callbacks must validate their execution context as the current trusted main
  frame before accepting login/logout payloads; third-party iframes receive neither session data
  nor a usable token callback.
- Preserve Maestro's update contract, Demo action, Control chat, Local provider integration, tab
  browser behavior, and existing renderer-measured native-view ownership.
- Exclude Cowork's forked CRMS renderer, avatar/profile UI, generic mini-app page-type/new-tab menus,
  update progress, and loading/crash tab-state work.

## Verification

- Independent source review compares the implementation with the focused Cowork source/docs and
  verifies event ownership, retained capture/debugger capabilities, local Home entry/partition/
  preload confinement, exclusions, and exact geometry.
- `git diff --check` must pass for task-owned files.
- Do not run tests, type checks, lint, builds, Electron, Playwright/E2E, AI-CRMS, network, or packaged
  app smoke in this delivery. Ral owns real-app acceptance.

## Delivery

- Source implementation completed on 2026-08-25.
- The first independent review recorded two lifecycle P1 findings and one stale-contract P2 finding;
  all were resolved: [review 1](../reviews/maestro-cowork-menubar-parity-006-1.md).
- Final independent source review approved the current tree with no remaining P0-P2 findings:
  [review 2](../reviews/maestro-cowork-menubar-parity-006-2.md).
- Task-owned `git diff --check` and new-file trailing-whitespace inspection passed. Runtime,
  automated, Electron, network, and E2E verification were intentionally not run; Ral owns the
  real-app acceptance above.
