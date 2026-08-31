# Maestro still uses pre-migration Cowork controls and a remote fixed tab

Status: implemented; owner verification pending

## Observed behavior

Maestro still renders the older Micromeet Cowork action cluster in the 48px address row:

```text
debugger · idle recording button · sidebar/layout · tools/workbench
```

That cluster no longer matches Cowork `dev/next` at `19b0621`. The current Cowork rules hide the
debugger entry, expose recording only as read-only status, and use Sparkles and Settings identities
for the sidebar and Workbench. The Control panel also owns an explicit close action that Maestro has
not migrated.

The fixed first tab also still loads `crms.micromeet.ai`. Current Cowork treats its fixed tab as a
first-party local renderer rather than a remote website. Maestro does not need Cowork's forked CRMS
renderer: its fixed tab should show Bitterless's existing authenticated Home content locally.

The preceding Maestro chrome task made the dark Omni-derived tab strip 44px high. The follow-up
visual correction reduces that strip and its tab geometry by 8px.

## Required behavior

```text
┌─ dark tab strip · 36px ────────────────────────────────────────────────┐
│ macOS ● ● ●   tabs · 28px · +                    recording status slot │
├─ address and actions · 48px ──────────────────────────────────────────┤
│ navigation · address · snapshot? · sparkles sidebar · settings · update│
└─────────────────────────────────────────────────────────────────────────┘
```

- Reduce only the dark tab strip from 44px to 36px. Tabs and every tab-row wrapper reduce from
  36px to 28px; the address/action row remains 48px and total chrome becomes 84px.
- Keep the macOS traffic lights horizontally aligned at `x: 12` and vertically centered at `y: 10`.
  Keep the existing 78px left gutter and renderer-measured native-view bounds.
- Remove the visible debugger action but retain the existing per-tab debugger capability and XPC
  path.
- Remove the clickable idle/recording button from the address row. Keep one fixed tab-row status
  slot: idle draws nothing; active recording draws a red pulsing dot. It is a non-interactive
  `role="status"`; agent/drill/budget capture flows remain the only recording owners.
- Keep Snapshot conditional on active recording and record actions.
- Render the Control/sidebar action with outline/filled Sparkles icons. Render Workbench with
  outline/filled Settings icons. Active state is blue-only rather than a white raised chip.
- Remove the obsolete Skills shortcut from the Control chat composer. Workbench remains available
  from the Settings entry, and the underlying Skills pane/broadcast capability remains intact.
- Add a 24px close action to the Control header. It broadcasts a Maestro-owned close event; Home
  subscribes once and persists the closed layout state. Reopening remains owned by the Sparkles
  MenuBar action.
- Replace the pinned `ai-crms` tab with a pinned local `home` tab. In development it loads a
  dedicated local Home-content renderer from the Vite server; in packaged builds it loads the
  bundled `renderer/maestro/localHome/index.html`.
- The local entry mounts Bitterless Home's existing `Chat.vue` plus `MessageSearch.vue`, with the
  same Arco, Markdown, KaTeX, theme, and i18n bootstrap. It does not mount either Home shell,
  MenuBar, router/login, side rail, or singleton shell/update/auth/Todo subscribers.
- Give that fixed tab a dedicated minimal preload that exposes only Electron XPC. Keep it in the
  Maestro partition; never give the Home preload or this local preload to ordinary website tabs.
- Keep the tab pinned, non-closable, non-recordable, and address-locked. Display
  `bitterless://home`; never expose a dev-server URL or packaged file path. Navigation is confined
  to the local Home entry.
- Existing AI-CRMS provider/login code is not the fixed tab owner. If that flow requests a login
  page, it must never replace or navigate the pinned local Home tab.

## Compatibility boundary

- Preserve Maestro's dark Omni surface, localized update action, Demo controls, Control chat, Local
  provider, capture lifecycle, and ordinary browser tabs.
- Do not copy Cowork's forked CRMS renderer, AI-CRMS avatar/profile UI, generic mini-app page-type
  menus, update-progress contract, or newer loading/crash tab state as part of this focused
  migration.

## Acceptance

- Source inspection confirms the old four-control cluster is absent and the current Cowork control
  semantics are adapted with Maestro-owned event names; the duplicate composer Skills entry is
  absent.
- Exact source geometry is 36px tab strip, 28px tabs/wrappers, 48px address row, 84px total chrome,
  and macOS traffic lights at `{ x: 12, y: 10 }`.
- The pinned tab's real target is local Home, its visible URL is `bitterless://home`, and no pinned
  tab path can load or navigate to `crms.micromeet.ai`.
- Ral verifies the real Electron window, recording status, sidebar close/reopen, Workbench toggle,
  embedded Home content, and native-control alignment.

Implementation task: [maestro-cowork-menubar-parity-006](../plan/tasks/maestro-cowork-menubar-parity-006.md).
Independent reviews: [initial blocked review](../plan/reviews/maestro-cowork-menubar-parity-006-1.md),
[final approved review](../plan/reviews/maestro-cowork-menubar-parity-006-2.md).

Follow-up: [task 076](../plan/tasks/maestro-control-entry-royalblue-076.md) retires the visible
Control-side Connector and Demo entries while preserving the fixed Home/Workbench Connector path
and the Main-owned Demo service contract.

Follow-up: [task 077](../plan/tasks/maestro-menubar-tab-inset-077.md) preserves the compact
36/28/48/84px geometry while superseding bottom-attached, top-only rounded tabs with centered
four-corner tabs and applying Ral's requested traffic-light optical shift from `y: 10` to `y: 11`.
