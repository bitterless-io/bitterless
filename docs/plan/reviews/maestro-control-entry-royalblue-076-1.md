# maestro-control-entry-royalblue-076 — Review 1

- Date: 2026-08-31
- Scope: independent review of the current-worktree implementation against
  `docs/plan/tasks/maestro-control-entry-royalblue-076.md`.
- Method: task/issue/source/diff inspection plus bounded `rg` and task-owned whitespace checks only.
  Per the assigned contract, no tests, typecheck, lint, build, Electron, Playwright/E2E, network,
  or packaged-app smoke was run.

## Findings

No P0-P2 findings.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Retire only the obsolete Control Connector and Demo entries | `ControlApp.vue:338-367` now renders only the Maestro channel and close action in the Control header. A bounded search of `ControlApp.vue` and `ControlApp.less` finds no Connector placeholder, Demo trigger/menu, compact-demo state/handlers, Demo/Connector icons, or their dead styles. The diff removes only those UI paths and their now-unused imports/state/functions. | pass |
| Preserve fixed Home and Workbench Connector capability | `localHome/src/components/LocalHomeMenu.vue:14-16,35-46` still opens `workbenchStore.openPane('connectors')`; `workbench.router.ts:10,26` still imports and registers `WorkbenchConnectorsView`; `workbench.store.ts:135-147` still includes `connectors`; and `WorkbenchConnectorsView.vue` still mounts the existing Connector view. None of these files is changed by the task diff. Connector message-source compatibility also remains in `channel.store.ts`, `message.type.ts`, `ChatPanel.vue`, and `MessageItem.vue`. | pass |
| Preserve the Main Demo API while removing its visible entry | `shared/maestro/coach.api.ts:36` retains `openDemo()`; `main/maestro/xpc/coach.handler.ts:119-121` still forwards it; and `maestroWindow.controller.ts:423-429,1584-1587` still owns and starts `BookingDemoService`. No Main/shared Demo file is in the task diff. | pass |
| Control chat still renders normally | `ControlApp.vue:249-268` initializes `channelStore` before clearing the loading state; `channel.store.ts:67-86` resolves or creates the active operation-tab session; and `ControlApp.vue:369-385` renders loading, then error, then `ChatPanel` whenever that session exists. The simplified `v-else-if="activeSession"` removes the deleted Connector branch without changing ChatPanel props, slots, send handling, or session identity. Injected skills still force `cowork` and resolve/start a Maestro session at `ControlApp.vue:204-215`. | pass |
| Every Arco-using Maestro renderer uses the Royal Blue Less pipeline | Home `main.ts:3-4`, Control `control.ts:2-3`, Workbench `workbench.ts:3-4`, and the already-themed Local Home `main.ts:3-4` all import `arco.less` plus `theme/global.less`; no `arco.css` import remains under `src/renderer/maestro`. `electron.vite.config.ts:554-561` applies `modifyVars: theme`, and `theme.ts:2-8` maps primary 6/5/7 to `#4e5882`/`#606b9d`/`#323955`, matching Arco Button default/hover/pressed tokens. | pass |
| Control no longer overrides Arco semantic colors | `ControlApp.less:12-21` now scopes only radius, typography, and mini-button height to `.arco-btn`; the former local primary/outline Arcoblue color blocks are deleted. Arco's Button tokens keep warning, danger, success, loading, and disabled branches distinct. Existing feature semantics remain in `ChatPanel.less`, including danger attachment/workspace actions, recording, busy, aborting, send-button Royal Blue interaction states, and explicit disabled treatment. Remaining `#165dff` rules in `ControlApp.less` belong to native Control channel/focus/popup semantics, not `.arco-btn`, and are outside the Arco Button override removed by this task. | pass |
| Documentation matches the implementation | The issue, task, `docs/features/maestro.md`, `docs/INDEX.md`, and `docs/plan/README.md` consistently describe a Control-only entry retirement, preserved fixed-Home/Workbench Connector and Main Demo contracts, and the shared `theme.ts` Royal Blue Arco pipeline. The source matches those boundaries. | pass |
| Task-owned whitespace gate | `git diff --check` passed for all five task-owned source files. Direct trailing-whitespace inspection passed for the new issue, task, and this review document. | pass |

## Verification

- Control entry/dead-code audit: passed.
- Connector and Demo preservation-boundary audit: passed.
- Control chat render-path audit: passed.
- Maestro Arco import/theme/token audit: passed.
- Control Arco override and semantic-state audit: passed.
- Tests, typecheck, lint, build, Electron, Playwright/E2E, network, and packaged-app smoke:
  **not run**, as explicitly required. Ral owns real-window visual and interaction acceptance.

## Conclusion

**Approved — no P0-P2 findings.**

The current diff removes only the obsolete Control-side Connector and Demo UI, retains the real
Connector and Main Demo capabilities, keeps Control chat reachable, and makes every Arco-using
Maestro renderer compile through the canonical Royal Blue theme without flattening semantic status
or disabled/loading behavior.
