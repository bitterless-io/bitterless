# Maestro Main-Window IoC Split

Status: implementation complete; owner runtime verification pending.

## Purpose

The legacy `src/main/maestro/windows/maestroWindow.helper.ts` combined the top-level
`BrowserWindow`, three child `WebContentsView` surfaces, browsing-tab lifecycle, capture, integration,
skill, workspace, request execution, and agent behavior in one 8,952-line module. The refactor
follows the proven Micromeet Cowork structure and uses Bitterless's existing `iocHelper` foundation
to give each native view and business domain one explicit owner without changing product behavior.

```text
Maestro XPC handlers
  -> MaestroWindowController
       -> MaestroBrowserViewService     browsing tabs and page views
       -> MaestroControlViewService     right-side agent panel
       -> MaestroWorkbenchViewService   workbench overlay
       -> WorkspaceFileService          workspace selection and file tools
       -> IntegrationService            recorded-site and integration workflows
       -> CaptureService                capture lifecycle and persisted records
       -> SkillService                  recipe generation and replay
       -> RequestExecService             browser/API request execution
       -> MaestroAgentService           agent session and turn orchestration
       -> MaestroLlmService             existing LLM service
```

The controller remains the public facade and owns top-level lifecycle, layout, settings, and
cross-domain coordination. Domain services own their state machines and implementations; the
controller exposes only the narrow XPC and tool facades required by existing callers.

## Module contract

| Module | Owns | Must not own |
|---|---|---|
| `main/maestroWindow.controller.ts` | Top-level window lifecycle, cross-view layout coordination, settings, LLM bootstrap, and narrow XPC/tool facades. | Child-view or extracted domain implementation details. |
| `main/maestroBrowserView.service.ts` | Browsing tab metadata; live/cold view slots; open, activate, reorder, close, restore, navigation, debugger toggle, tab broadcasts, context menus, injected buttons, and view teardown. | Capture-session state and agent turns. |
| `main/maestroControlView.service.ts` | Control-panel view creation, loading, DevTools policy, bounds, and teardown. | Renderer business state. |
| `main/maestroWorkbenchView.service.ts` | Workbench view creation, visibility, loading, bounds, visibility broadcast, and teardown. | Capture-record persistence. |
| `main/workspaceFile.service.ts` | Workspace selection, status, path safety, file tools, search, artifact context, and workspace synchronization. | Browser-view lifecycle. |
| `integration/integration.service.ts` | Integration targets, mappings, recorded-site transformation, generated integration tools, and scheduler coordination. | Capture-session ownership. |
| `capture/capture.service.ts` | Bitterless capture state, debugger capture, trace/network assembly, persistence, target switching, and capture broadcasts. | Agent-turn orchestration. |
| `skills/skill.service.ts` | Skill generation, validation, persistence, replay, and training helpers. | Direct ownership of browser tabs. |
| `drive/requestExec.service.ts` | Browser/API request execution, approval flow integration, request replay, and new-tab notes. | Agent session lifecycle. |
| `agent/maestroAgent.service.ts` | Agent session hydration, prompt/run state, tool-call orchestration, trace/activity broadcasts, and turn cancellation. | Native view construction or window layout. |
| `main/viewBounds.ts` | Per-view redundant-bounds suppression. | Window or view lifecycle. |

## IoC invariants

- Every service extends `CommonService<ServiceState>` and declares its state interface in its own
  file. A service must not import the controller module.
- Every injected constructor parameter has an explicit `@inject(Symbol.for(Service.name))`.
- Every injected service appears once in the single `iocHelper.bind({ controller, services })`
  registration.
- Only the controller calls `setState(this)`. Services remain leaf-level; service-to-service calls
  route through the narrow state interface.
- State interfaces expose only the callbacks and state required by their service. Extracted services
  own their mutable domain state and reset it during window shutdown where applicable.
- The exported singleton remains `maestroWindowHelper` so the two XPC handlers keep their external
  contract.

## Behavior invariants

- XPC methods, parameter/return shapes, and broadcast channel names remain unchanged.
- Startup order remains: create the top-level window, attach all child views, load the pinned
  bundled Home tab and first-party renderers, then reveal the window after the readiness fence.
- The pinned local Home tab is non-recordable and non-debuggable. AI-CRMS authentication uses a
  separate closable, non-persisted login tab whose auth bridge is detached before its debugger/view
  on tab eviction, tab close, authentication cleanup, and native-window shutdown.
- The warm/cold browser-tab cap, ordinary-tab debugger attachment, capture-target switching,
  workbench overlay, browser-tab persistence, and remaining close/shutdown behavior stay owned by
  their extracted services.
- Existing source guards must follow moved code; no guard may continue reading a retired path and
  silently stop asserting its subject.

## Verification

- `yarn typecheck:node`
- `yarn check:maestro`
- `yarn build`
- Source review against the Cowork reference implementation
- Owner manual runtime smoke: open Maestro, switch/open/close tabs, toggle Workbench, start/stop one
  capture, and send one Maestro message.
