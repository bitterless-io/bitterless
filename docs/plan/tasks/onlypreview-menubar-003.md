---
id: onlypreview-menubar-003
scope: Align the standalone OnlyPreview MenuBar with the EyesOnAgents window pattern
status: in-progress
depends-on: [onlypreview-standalone-only-002]
---

# Objective

Replace OnlyPreview's 44px white command topbar and default native titlebar treatment with the
established EyesOnAgents standalone-window effect: one Shell-owned 32px Royal Blue MenuBar,
platform-correct native/custom window controls, and typed Main-owned window operations. Preserve
OnlyPreview's independent Shell + Preview `WebContentsView` graph, file actions, capability model,
status rail, settings, and complete Omni exclusion.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/eyes-on-agents-menubar-domain-guide-014.md`
- `docs/plan/tasks/onlypreview-standalone-only-002.md`

# Path

- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-menubar-003.md`

# Implementation Constraints

1. Keep OnlyPreview standalone-only. Do not add it to Omni or collapse Shell and Preview into one
   renderer; MenuBar remains Shell-owned and Preview remains content-only.
2. Follow EyesOnAgents's observable chrome contract without importing its private component,
   emitter, store, Domain, connection, bridge, or always-on-top behavior.
3. Use a 32px Royal Blue drag region, light identity/actions, dark bottom divider, 27px controls,
   78px macOS traffic-light gutter, and Windows minimize/maximize/close controls. Interactive
   controls are `no-drag`; double-click on the non-action region toggles maximize/restore.
4. Preserve labelled Open File/Open Folder plus icon-only Refresh/Settings actions and their
   current disabled/business behavior. Keep localized labels, tooltips, visible keyboard focus,
   stable `name` attributes, and `onlypreview`-rooted BEM classes.
5. Configure the `BaseWindow` with the hidden titlebar treatment, auto-hidden application menu,
   and macOS traffic-light position used by EyesOnAgents. Window commands must go through new
   capability-scoped OnlyPreview API methods and mutate only the active standalone window.
6. Change the trusted Preview top offset and clamping constant from 44px to exactly 32px; keep the
   180px sidebar minimum, 5px resize handle, 25px status rail, and all security checks unchanged.
7. Do not add dependencies or modify the unrelated existing `package.json` DEBUG-name change.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- targeted error-level ESLint for touched TS/Vue/test sources
- `yarn build`
- completely exit the current Electron Main and launch a fresh Main before native chrome
  acceptance; renderer HMR does not verify window creation-time options
- `yarn test:e2e:onlypreview`, including explicit proof that native window/content bounds have no
  titlebar gap and that the top-middle native PNG band is majority Royal Blue `#4E5882`
- visual inspection at the normal and 800×600 window sizes confirms the EyesOnAgents MenuBar
  hierarchy, macOS inset or Windows controls, hover/focus states, and exact native Preview offset
- `git diff --check`
