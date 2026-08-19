---
id: eyes-on-agents-agent-connections-navigation-045
scope: Organize Agent connections by a compact official-logo app rail and provider-specific detail pane
status: done
depends-on: [eyes-on-agents-hide-unavailable-claude-open-044]
---

# EyesOnAgents Agent Connections Navigation

## Objective

Replace the long mixed-provider Agent connections stack with a clear master-detail layout: a fixed
60px Agent App category rail on the left and the selected provider's existing connection methods on
the right. Codex and Claude use the official local PNG marks delivered in task 043.

## Information architecture

```text
┌ Agent connections                                      × ┐
├────────┬─────────────────────────────────────────────────┤
│ Codex  │ Managed App Server                              │
│  logo  │ Codex Desktop boundary                          │
│ Codex  │ Global Codex observation                        │
│        │                                                 │
│ Claude │                                                 │
│  logo  │                                                 │
│ Claude │                                                 │
└────────┴─────────────────────────────────────────────────┘
```

- Drawer width is 540px with `max-width: 100vw`.
- The left rail is exactly 60px. Each 52×56px category shows the official mark above a compact
  Codex/Claude label. The active item uses the existing white surface on the cool-grey rail—no
  border, shadow, brand-color panel, or connection-status badge.
- Codex detail owns the existing App Server card, Desktop boundary note, and Codex observation card.
- Claude detail owns the complete existing `ClaudeObservationCard`: provider switch, directories,
  plugin/listener facts, and its state-driven setup/repair/reload actions stay together.
- The rail chooses what to inspect; it never enables, disables, connects, installs, or removes
  anything. Claude remains selectable while Claude support is Off.
- Use `v-show` for the two detail panels so switching providers does not destroy troubleshooting,
  copy feedback, busy state, or component-local state. Each detail panel owns vertical scrolling;
  the rail remains fixed.

## Interaction and accessibility

- Implement a vertical `tablist` with native buttons using `role="tab"`, `aria-selected`,
  `aria-controls`, and roving `tabindex`; panels use `role="tabpanel"` and matching labels.
- Click selects. `ArrowUp`/`ArrowDown` wrap between providers; `Home`/`End` move to first/last and
  focus the selected tab. Switching does not move focus into the detail pane.
- Drawer Escape/mask-close behavior and every existing connection action/store call remain.
- On viewports below 480px, shrink the rail to 52px and category boxes to 44px; hide the visible
  labels while retaining native title/ARIA names. Detail padding shrinks to 10px.

## Visual contract

- Rail background: `#eef1fa`; active item white; hover `#f7f8fc`; keyboard outline uses the existing
  Royal Blue focus color.
- Codex PNG renders at 24×24px; Claude PNG at 23×23px to retain their established optical ratio.
- Right detail width is approximately 452px after padding. Reuse all existing cards and background
  hierarchy; do not add another card shell, divider, status row, or decorative chrome.

## Path

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/agent-connections-navigation.test.mjs`
- `package.json`

## Verification

- Render tests cover default Codex, click Claude/Codex, keyboard wrap/Home/End, roving tabindex,
  tab/panel ARIA, Claude Off selectability, and the absence of connection API calls on navigation.
- Assert both panels remain mounted under `v-show`, and every provider action is still inside the
  correct detail panel and wired to its existing store method.
- Source/style tests pin 540/60/52px geometry, 24/23px official PNG mapping, narrow layout, fixed
  rail, independently scrolling panels, and absence of new border/shadow/status decoration.
- Inspect 100% rendered layouts at 540px and a sub-480px width before acceptance.
- Run the EyesOnAgents UI aggregate, strict UI typecheck, renderer i18n check, production build, and
  `git diff --check` without launching Electron.
- Independent review must report no open P1, P2, or P3 before completion.

## Implementation evidence

- `ConnectionPanel` now renders a 540px master-detail drawer with a native vertical tablist. The
  fixed 60px rail imports the task-043 Codex and Claude PNGs directly and renders them at 24px and
  23px; it is navigation-only and remains independent of the Claude provider switch.
- The original App Server, Codex Desktop boundary, and Codex observation sections stay together in
  the Codex panel. The complete existing `ClaudeObservationCard` stays in the Claude panel. Both
  panels remain mounted under `v-show`, own their scrolling, and retain every existing action and
  store call.
- Click, roving `tabindex`, tab/panel ARIA relationships, wrapped Arrow navigation, and Home/End
  selection use native buttons. At widths below 480px the rail becomes 52px, each category becomes
  44px, the visible labels disappear, and native title/ARIA names remain.
- Arco places the numeric drawer width on an inner `.arco-drawer`; the viewport cap therefore
  explicitly covers both the component container and that inner element. This prevents the 540px
  body from clipping the rail when the host is narrower than the configured drawer.
- Because Arco teleports the drawer outside `.eyes-on-agents`, the drawer container defines its own
  `--eyes-focus-ring: #4e5882` boundary so keyboard tabs keep a visible Royal Blue outline.

## Verification evidence

- `node --test scripts/eyes-on-agents/agent-connections-navigation.test.mjs` — passed 2/2. The new
  468-line focused test pins source/style geometry and mounts the actual panel navigation in JSDOM.
  It exercises click, wrapped ArrowUp/ArrowDown, Home/End, focus, roving `tabindex`, tab/panel ARIA,
  Claude-Off selection, zero connection calls during navigation, and Claude local-state retention.
- `yarn test:eyes-on-agents:ui` — passed 65/65 with the focused test included once in the aggregate.
- `yarn typecheck:eyes-on-agents:ui` and `yarn check:renderer-i18n` — passed.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn electron-vite build` —
  passed without the package-mutating release prebuild and emitted both local provider PNGs.
- A real production renderer build was served to headless signed Google Chrome at DPR 1 without
  Electron. Codex and Claude were inspected at the exact 540px drawer width, and Claude-Off was
  inspected again at a 460px viewport: the measured layout was 460px drawer/body, 52px rail, 44px
  tab, 408px detail, zero horizontal overflow, and hidden visible labels with intact logo tabs.
- `git diff --check` — passed. Independent review remains required before this task is marked done.
