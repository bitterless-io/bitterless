# maestro-cowork-menubar-parity-006 — Review 2

- Date: 2026-08-25
- Scope: second independent review of the task-owned current-worktree changes, including
  `src/main/maestro/auth/authBridge.ts`; Review 1 findings were rechecked against the final source.
  Parallel translator, Codex runtime, and application-diagnostics changes were excluded.
- Method: source inspection only. Per task contract, no tests, typecheck, lint, build, Electron,
  E2E, network, or packaged-app smoke was run.

## Findings

No P0-P2 findings.

## Review 1 resolution

| Review 1 finding | Resolution evidence | Result |
|---|---|---|
| P1: AI-CRMS cooling/closing was not linearized against preparation | `maestroBrowserView.service.ts:460-468` rejects cooling/non-owned views at every preparation fence; `:649-703` makes the slot non-live before the first await, awaits the captured preparation, and performs a final owner-specific bridge detach before debugger/view destruction. `:1153-1184` shares the complete close transaction through `closeReady` and resolves the tab by identity after async cooling, preventing duplicate close and stale-index reorder races. | resolved |
| P1: native close began cleanup after child-view destruction | `maestroWindow.handler.ts:158-171` prevents the native close and starts the shared cleanup transaction before destruction; `maestroWindow.controller.ts:1616-1625` quiesces AI-CRMS preparation/bridge ownership before capture shutdown, view reset, and `BrowserWindow.destroy()`. The `closed` listener is a re-entrant fallback through the same cleanup promise. | resolved |
| P2: IoC document still required a pinned AI-CRMS tab | `maestro-window-ioc.md:64-72` now specifies pinned bundled Home plus a separate closable/non-persisted AI-CRMS login tab and its bridge-first teardown contract. | resolved |

The `about:blank` bootstrap at `maestroBrowserView.service.ts:547-568` remains valid: Electron's
local event contract excludes programmatic `webContents.loadURL()` from `will-frame-navigate`, and
the initial blank URL is additionally admitted by the AI-CRMS navigation guard at `:450-457`.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| 36/28/48/84 geometry, Omni colors, 78px mac gutter, and traffic-light placement | `MenuBar.less:1-18,35-38,91-105`; `maestroWindow.controller.ts:152-155`; `window.helper.ts:58-64` (`x: 12`, `y: 10`); renderer-measured bounds remain authoritative | pass |
| Current Cowork action semantics | `MenuBar.vue:187-201,256-295` has the read-only capture status, conditional Snapshot, Sparkles Control, and Settings Workbench controls; active state is blue-only in `MenuBar.less`; the debugger control is absent while `tab.store.ts:213-221` retains its XPC action | pass |
| Control close and composer Skills behavior | `ControlApp.vue` broadcasts `coach/sidebar-close`; `layout.store.ts` owns one guarded subscriber and closes the sidebar; `ChatPanel.vue:523-527` hides only the duplicate composer shortcut while Workbench Skills routing/broadcast remains | pass |
| Bundled local Home entry and dependency confinement | `electron.vite.config.ts:446-449,495-499`; `localHome/src/main.ts`; `LocalHomeApp.vue`; `localHome.preload.ts`. The entry mounts Chat + MessageSearch with Arco/Markdown/KaTeX/theme/i18n dependencies and does not import shell/router/login/auth/Todo/update subscribers | pass |
| MessageSearch without local router leakage | `messageSearch.store.ts:88-101` skips routing on the explicitly marked local surface and dynamically imports the Home router only for the ordinary Home window | pass |
| Pinned Home security, display URL, reconstruction, and i18n | `maestroBrowserView.service.ts:181-215,400-448,736-779,1186-1226`; `tab.store.ts:15-29,64-129`; `MenuBar.vue:43-47`; `en.ts:60`; `zh.ts:60`. Home is pinned/locked/non-recordable/non-debuggable, exposes only `bitterless://home`, and rebuilds from the internal local target | pass |
| Dedicated AI-CRMS tab and startup order | `maestroBrowserView.service.ts:519-568,1028-1077` confines one closable/non-persisted/non-recordable ordinary view to the trusted host and orders `about:blank` → confirmed DebuggerCapture attach → auth bridge attach → trusted navigation | pass |
| Main-frame injection and binding validation | `authBridge.ts:29-45,66-126,144-178,216-269` guards document-start data by trusted top frame, requires the current trusted main-frame execution context for binding payloads, and fails closed when bridge setup is incomplete | pass |
| AI-CRMS close/evict/reset/shutdown teardown | `maestroBrowserView.service.ts:470-568,649-703,1153-1184`; `maestroWindow.controller.ts:1616-1625`; `maestroWindow.handler.ts:158-171,247-273` serialize preparation/cleanup and detach the bridge before debugger/view closure across all reviewed lifecycle paths | pass |
| Browser persistence, Workbench, injection, and capture regressions | Persistence and domain seeding remain browser-only in `tab.store.ts` and `workbench.store.ts`; injection and capture eligibility remain browser-only in `maestroBrowserView.service.ts` and `capture.service.ts`; fixed Home and AI login tabs do not enter those paths | pass |
| Feature/task contract coherence | `docs/features/maestro.md`, `docs/features/maestro-window-ioc.md`, the issue, and task now describe the same current controls, fixed local Home tab, localized title, and temporary AI-CRMS login lifecycle | pass |
| Task-owned whitespace gate | `git diff --check -- <task-owned paths>` plus trailing-whitespace inspection of new local Home/preload/review files | pass |

## Conclusion

**Approved — no P0-P2 findings.**

The Review 1 lifecycle and documentation blockers are resolved in the final source. The compact
Cowork controls, local Home privilege boundary, AI-CRMS bridge ordering, and ordinary browser-tab
capabilities are mutually consistent under static review. Ral's Electron/runtime visual and E2E
acceptance remains intentionally unrun and is the delivery handoff.
