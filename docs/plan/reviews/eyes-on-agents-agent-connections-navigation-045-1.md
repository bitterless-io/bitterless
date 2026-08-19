# EyesOnAgents Agent Connections Navigation — Independent Acceptance

Status: accepted

Date: 2026-08-18

## Verdict

**Implementation: Closed — PASS, with no open P1, P2, or P3 finding.** Provider ownership,
navigation behavior, mounted-state retention, responsive geometry, local PNG rendering, scrolling,
drawer dismissal, and keyboard focus all pass in the frozen production renderer. The original P2
was resolved by defining the Royal Blue focus token on the teleported Drawer itself.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None open. The first frozen candidate lost its focus color because Arco
  teleported the Drawer outside `.eyes-on-agents`. The refreeze defines
  `--eyes-focus-ring: #4e5882` directly on `.eyes-connection-panel`; real production Chrome now
  computes a solid 2px `rgb(78, 88, 130)` outline with `-2px` offset on the keyboard-focused tab.
- **P3 · non-blocking:** None.

## Acceptance object and product closure

- Entity: the selected Agent App and its provider-specific connection methods.
- User: Ral supervising local Codex and Claude sessions.
- Entry point: the **Agent connections** drawer from the EyesOnAgents menu bar.
- Successful terminal state: select Codex or Claude by pointer or keyboard, inspect the complete
  provider pane without triggering a connection mutation, and dismiss the drawer normally.
- Product/design owner: Ral. Implementation owner: task-045 Develop agent. Independent acceptance:
  this review.

| Operation | User path | System behavior | Evidence | Status |
|---|---|---|---|---|
| Create | N/A | Provider categories are fixed product capabilities, not user-created records. | Frozen two-provider contract | N/A — justified |
| Read | Open drawer and select Codex/Claude | Shows only the selected provider pane while both panes remain mounted. | Production DOM, screenshots, focused test | Complete |
| Update | Click or use Arrow/Home/End | Selection, visible focus, roving tabindex, and panel visibility update without a connection API call. | Production interaction run and JSDOM test | Complete |
| Delete | N/A | The rail cannot remove a provider; Claude support is controlled only by the switch in its pane. | Claude-Off production run | N/A — justified |

## Passing interaction and product evidence

1. Default state selected Codex with `aria-selected="true"`, `tabindex="0"`, and only the Codex
   panel visible. Click and Arrow Up/Down wrapping plus Home/End all selected and focused the
   expected tab. Navigation added zero `EyesOnAgentsHandler` calls.

2. The tab/panel graph is complete: a labelled vertical tablist, two `aria-controls` links, two
   matching `aria-labelledby` panels, and roving tabindex. At 460px the visible labels become
   `display:none`, but real Chrome's Accessibility Tree still exposed `tab "Codex"` and
   `tab "Claude"` through each native button's `title`; narrow accessibility naming passes.

3. Claude remained selectable while support was Off. Its panel showed the Off status, support
   switch, and paused explanation, with no provider action caused by rail navigation.

4. Both `v-show` panes stayed mounted. Expanding **Still not working?**, switching to Codex, and
   returning preserved the expanded troubleshooting state. A delayed **Check status** action stayed
   disabled/busy through the same switch and resolved normally afterward.

5. Content ownership is complete. Codex retains Managed App Server, the Desktop boundary note,
   Global Codex observation, and its original actions/store methods. Claude retains the full
   `ClaudeObservationCard`, including support, directories, plugin/listener facts, setup/reload,
   diagnostics, and removal.

6. Production Arco behavior was exercised without Electron: Escape, mask click, and the accessible
   close button each dismissed the drawer after its transition.

## 100% visual and responsive evidence

The current production renderer was served to headless signed Google Chrome at DPR 1. Codex and
Claude were inspected in a 540px Drawer, and Claude-Off was inspected at a 460px viewport.

| Surface | Measured geometry | Result |
|---|---|---|
| 540px Codex | Drawer/body 540px; rail 60px; tabs 52×56px; logos 24/23px; detail grid cell 480px with 14px padding | Correct master-detail hierarchy; App Server, boundary, and observation remain legible and unclipped. |
| 540px Claude | Same rail/mark geometry; complete Claude card in the right pane | Correct provider ownership; no added outer card, divider, rail shadow, or status badge. |
| 460px Claude-Off | Drawer/body 460px; rail 52px; tabs 44×44px; detail 408px with 10px padding; labels hidden | No horizontal clipping; official logos remain centered; Off state stays concise and selectable. |
| Scrolling | Drawer body and grid body `scrollWidth === clientWidth`; outer body overflow hidden; rail fixed; long Codex detail owns vertical scroll | No rail scroll, double vertical scroll, or provider-pane bleed. |

The inspected captures were `/tmp/eyes-connections-045-settled-codex.png`,
`/tmp/eyes-connections-045-wide-claude.png`, and
`/tmp/eyes-connections-045-narrow-claude-off.png`.

## Independent verification

| Check | Result |
|---|---|
| `node --test scripts/eyes-on-agents/agent-connections-navigation.test.mjs` | PASS — 2/2 |
| `yarn test:eyes-on-agents:ui` | PASS — 65/65 |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn check:renderer-i18n` | PASS |
| `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn electron-vite build` | PASS; local Codex and Claude PNGs emitted |
| `git diff --check` | PASS |
| Production Chrome navigation, state-retention, responsive, Accessibility Tree, scrolling, and dismissal run | PASS after focus-token refreeze |
| Refrozen teleported-Drawer keyboard focus in production Chrome | PASS — `:focus-visible`; solid 2px `rgb(78, 88, 130)` outline; `-2px` offset; token resolves locally outside `.eyes-on-agents` |

No Electron process, provider connection, database, user profile, credential store, or
secret-bearing file was opened or mutated. This Verify delivery changes only this review file and
preserves the unrelated existing `package.json` change and concurrent task work.

## P2 resolution evidence

The production renderer was rebuilt from the refrozen source, served without Electron, and opened
in signed Google Chrome at DPR 1. Arrow Down moved focus from Codex to Claude. The focused Claude
tab matched `:focus-visible`, retained `aria-selected="true"`, resolved
`--eyes-focus-ring` to `#4e5882`, and computed `outline-style: solid`, `outline-width: 2px`,
`outline-color: rgb(78, 88, 130)`, and `outline-offset: -2px`. The tab remained outside
`.eyes-on-agents`, proving the fix closes the actual teleport boundary rather than passing through
the app-root inheritance path. The visible result was inspected at
`/tmp/eyes-connections-045-focus-refreeze.png`.

## Acceptance checklist

- [x] Default Codex, click switching, wrapped Arrow navigation, Home/End, roving tabindex, and ARIA.
- [x] Claude-Off remains selectable and navigation triggers zero connection APIs.
- [x] Both panes remain mounted; Claude local state and a busy action survive provider switching.
- [x] Codex and Claude content/action ownership is complete.
- [x] 540px and 460px geometry, logo sizing, fixed rail, independent detail scrolling, and no new chrome.
- [x] Narrow hidden labels retain accessible Codex/Claude names in Chrome's Accessibility Tree.
- [x] Escape, mask, and close-button dismissal retain production behavior.
- [x] Keyboard focus has a visible Royal Blue outline in the real teleported Drawer.

## Conclusion

**accepted** — the refreeze resolves the teleported-Drawer focus-token scope. Task 045 meets its
navigation, provider ownership, mounted-state, responsive, scrolling, dismissal, and accessibility
contracts with zero open finding.
