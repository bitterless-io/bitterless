# maestro-cowork-menubar-parity-006 — Review 1

- Date: 2026-08-25
- Scope: task-owned current-worktree changes, the task/issue/feature contracts, Cowork
  `19b0621`, and `src/main/maestro/auth/authBridge.ts`.
- Method: source inspection only. Per task contract, no tests, typecheck, lint, build, Electron,
  E2E, network, or packaged-app smoke was run.

## Findings

### 1. P1 · blocking — cooling/closing an AI-CRMS tab is not linearized against its preparation queue

- Design: `docs/plan/tasks/maestro-cowork-menubar-parity-006.md:72-80`.
- Code: `src/main/maestro/windows/main/maestroBrowserView.service.ts:455-474,476-535,615-635,1085-1096`.
- Evidence: `coolTab()` awaits `detachAuthBridgeForTab(tab)` before it removes or otherwise
  invalidates `tab.view`. That first `await` yields while `isLiveTabView()` can still return true.
  A concurrent queued `prepareAiCrmsTab()` can therefore pass its live-view checks, attach the
  debugger, assign `authBridgeOwner`, and attach `authBridge` after the first detach decision has
  already been made. `coolTab()` then resumes by detaching `bridgeCapture` and closing the view,
  without a second bridge detach. The singleton bridge can remain wired to a destroyed
  `WebContents`, contrary to the required close/evict ordering.
- Impact: close or warm-cap eviction can race AI-CRMS login preparation and leave bridge ownership
  inconsistent until a later unrelated attach/detach. The tab must be made synchronously non-live
  before the first await, and teardown must await/cancel the tab's preparation before the final
  bridge-detach → debugger-detach → view-close sequence.

### 2. P1 · blocking — native Maestro window close starts bridge cleanup only after the child view is destroyed

- Design: `docs/plan/tasks/maestro-cowork-menubar-parity-006.md:72-80`.
- Code: `src/main/xpc/maestroWindow.handler.ts:158-161,237-263`;
  `src/main/maestro/windows/main/maestroWindow.controller.ts:1616-1625`.
- Evidence: the handler starts `destroyMaestroRuntime()` from BrowserWindow's `closed` event. At
  that point the window and its child `WebContentsView` graph have already closed. Only afterward
  does `shutdown()` call `await this.browserView.detachAuthBridge()`. The normal explicit shutdown
  path has the correct order, but clicking the native close control does not.
- Impact: the window-teardown path violates the contract that the bridge is detached before its
  debugger/view is destroyed. Cleanup needs to begin from a pre-destruction close path (with
  re-entry protection) rather than relying on `closed`.

### 3. P2 · blocking — the IoC feature contract still requires the removed pinned AI-CRMS startup tab

- Design: `docs/features/maestro.md:242-273`;
  `docs/plan/tasks/maestro-cowork-menubar-parity-006.md:61-80`.
- Conflicting document: `docs/features/maestro-window-ioc.md:64-68`.
- Evidence: the current Maestro feature and implementation make bundled local Home the pinned first
  tab and isolate AI-CRMS login in an ephemeral tab, while the IoC feature still says startup loads
  a pinned AI-CRMS tab and that this tab retains debugger/capture behavior.
- Impact: two active feature contracts prescribe mutually exclusive startup and tab ownership. The
  IoC document must retain its module-ownership rules while updating these behavior invariants to
  local Home plus the dedicated login-tab lifecycle.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| 36/28/48/84 geometry and traffic lights | `MenuBar.less:1-18,35-38,91-105`; `maestroWindow.controller.ts:152-155,1501-1508`; `window.helper.ts:58-64` | pass |
| Current Cowork controls | `MenuBar.vue:187-201,259-295`; `MenuBar.less:96-97,141-142`; `ControlApp.vue:206-210,494-503`; `ChatPanel.vue:523-527` | pass |
| Retained debugger/capture/Workbench capabilities | `tab.store.ts:213-221`; `capture.store.ts:33-44`; `maestroBrowserView.service.ts:272-295`; Workbench Skills pane/broadcast paths remain | pass |
| Bundled local Home entry and minimal preload | `electron.vite.config.ts:446-449,495-499`; `localHome/src/main.ts`; `LocalHomeApp.vue`; `localHome.preload.ts` | pass |
| No router/login/shell singleton graph | local entry mounts only `Chat` + `MessageSearch`; router import is dynamic and skipped on the marked surface in `messageSearch.store.ts:88-101` | pass |
| Pinned Home URL confinement and privilege separation | `maestroBrowserView.service.ts:62-69,181-215,400-446,666-746,758-765,1114-1127` | pass |
| Home non-recordable/non-debuggable | `capture.service.ts:173-181,260-289`; `maestroBrowserView.service.ts:186-194,272-276,1043-1046` | pass |
| AI-CRMS startup order and frame/binding checks | `maestroBrowserView.service.ts:487-535`; `authBridge.ts:29-45,66-125,215-269` | pass in the non-racing path; teardown blocked by Findings 1-2 |
| `about:blank` bootstrap guard interaction | Electron's local type contract states programmatic `webContents.loadURL` does not emit `will-frame-navigate`; the service bootstrap at `maestroBrowserView.service.ts:515` is therefore not blocked by lines 666-671 | pass |
| Browser-tab persistence, domain seeding, injection confinement | `tab.store.ts:15-29,64-129`; `workbench.store.ts:1098-1103`; `maestroBrowserView.service.ts:707-730,1134-1226` | pass |
| Task-owned whitespace gate | `git diff --check -- <task-owned tracked paths>` | pass |

## Conclusion

**blocked**

The visible Cowork parity, exact compact geometry, local Home renderer, address masking, capture/
debugger exclusions, and trusted-frame checks match the focused contract in source. Findings 1-2
block delivery because bridge teardown is not safe across close/eviction/native-window lifecycle;
Finding 3 blocks the docs-driven contract from having one coherent source of truth. Ral's runtime
acceptance remains intentionally unrun.
