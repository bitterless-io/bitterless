---
id: desktop-update-menubars-009
scope: compact automatic-update action across Home, Maestro, and Omni window chrome
status: implemented; owner verification pending
depends-on: [desktop-auto-update-state-replay-008]
---

# Desktop Update Menu Bars

## Objective

Expose downloaded-ready update installation from the Omni Browser Menu Bar and keep every existing
menu-bar update button at the exact compact visible label `update` in all states and languages.

## Context

- `docs/features/desktop-auto-update.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/design/customer-authentication.md`
- `docs/plan/tasks/desktop-auto-update-state-replay-008.md`

## Layout

```text
Home     │ Bitterless                         [update] [Proxy] [window controls] │
Maestro  │ tabs · address · tools                         [update] [other tools] │
Omni     │ Omni Browser [Layout]                       [update] [window controls] │
```

The existing Royal Blue Home/Omni chrome and Maestro toolbar remain unchanged. The single visual
decision is a short, content-width action using each Menu Bar's established update treatment; no
new icon, toolbar, fixed width, or decorative element is introduced.

## Design fit

- **Palette:** Royal Blue chrome `#4E5882`, chrome edge `#3D4666`, ready amber `#F29A00`, amber
  hover `#E28600`, label ink `#1E1A4D`, and Maestro white `#FFFFFF`; these are the existing menu and
  update colors, not a new theme.
- **Type:** keep the existing utility typography—12px/500 in Home and Omni, 13px/500 in Maestro—so
  the action reads as window chrome rather than page content.
- **Layout:** one content-width action at each owning Menu Bar's trailing edge; Omni's instance sits
  after the flexible title/Layout region and before native Windows controls.
- **Signature:** the exact compact `update` label is the only new visual identifier. Detailed state
  remains in title and disabled behavior, avoiding an icon or expanding busy copy.
- **Critique:** a new badge system or animated treatment would compete with established chrome and
  add width. Reusing the existing amber/shimmer treatments keeps this change specific and restrained.

## Path

- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/home/src/components/MenuBar/MenuBar.vue`
- `src/renderer/home/src/store/update.store.ts`
- `src/renderer/home/src/xpc/update.subscriber.ts`
- `src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue`
- `src/renderer/maestro/home/src/store/update.store.ts`
- `src/renderer/omni/omniWindow/src/main.ts`
- `src/renderer/omni/omniWindow/src/App.vue`
- `src/renderer/omni/omniWindow/src/App.less`
- `tests/update/updatePolling.test.mjs`
- `tests/omni/omniLayoutLifecycle.test.mjs`
- `scripts/maestro/check-update-ux.mjs`
- `scripts/renderer-i18n/check-renderer-i18n.mjs`
- `docs/features/desktop-auto-update.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/design/customer-authentication.md`
- `docs/plan/tasks/desktop-update-menubars-009.md`

## Required behavior

- Home, Maestro, and Omni display the exact lowercase visible label `update`; the label does not
  change while Maestro downloads and both supported UI languages resolve to the same literal.
- Existing detailed titles remain allowed so the compact text does not hide downloading or target
  version meaning from mouse and assistive-technology users.
- Omni's top-level `omniWindow` Menu Bar—the same 32px bar that owns `Layout`—owns exactly one update
  action at the right edge before Windows native controls. `omniCell`, `omniControl`/
  `OmniPaneMenuBar`, and every embedded mini-app or subwindow must not import, render, or subscribe
  to this update action.
- Omni reuses Home's existing ready store and subscriber. It subscribes synchronously to
  `app/updated`, then requests `UpdateHandler/getReadyUpdate` asynchronously before language waiting
  and Vue mount. The shared path validates the full Home `UpdateInfo` shape, treats explicit `null`
  as normal absence, logs malformed or failed replay, and lets valid live state win.
- Omni shows the action only after download readiness and calls `UpdateHandler/quitAndInstall` when
  clicked. It must not start another poll, fetch update metadata, or own updater transport.
- Preserve Home/Maestro update state, the idempotent Main polling coordinator, updater gates,
  installation lifecycle, language bootstrap, and all unrelated primary-worktree changes.

## Verification

- Behavioral update tests cover Omni no-snapshot/replay, live-over-stale ordering, malformed input,
  request failure, subscribe-before-query, and install routing.
- Source/UI guards prove the Omni action sits in the window Menu Bar, uses the shared literal, stays
  before Windows controls, and does not add update state, subscription, or labels to `omniCell`,
  `OmniPaneMenuBar`, or embedded mini-app/subwindow surfaces.
- `yarn test:desktop-auto-update`
- `node --test tests/omni/omniLayoutLifecycle.test.mjs`
- `node scripts/maestro/check-update-ux.mjs`
- `yarn check:renderer-i18n`
- Focused strict renderer TypeScript, targeted lint with the existing JavaScript return-type rule
  excluded, and committed diff checks pass.
- Independent review finds no open P1, P2, or P3 issue.
- Do not launch Electron, build, package, sign, notarize, publish, upload, refresh CDN, or access the
  remote update feed; Ral retains real-device visual and update acceptance.

## Delivery evidence — 2026-07-27

- Commit `e80b756` adds exactly one ready-only update action to the top-level `omniWindow` Menu Bar,
  after the flexible `Layout` region and before native Windows controls. It reuses Home's ready store
  and subscribe-before-snapshot path without adding polling.
- Home, Maestro, and Omni resolve their visible action from the same en/zh value, the intentional
  lowercase literal `update`. Maestro keeps that label while downloading and preserves disabled and
  detailed-title state.
- `omniCell` and the complete Omni Control source tree are guarded against update state,
  subscription, and label ownership, so pane count and embedded content cannot duplicate the action.
- Follow-up commit `931b81b` localizes Omni's target-version tooltip in English and Chinese while
  preserving the compact visible label.
- Desktop automatic-update tests passed 17/17, Omni lifecycle passed 8/8, and Maestro update UX,
  renderer-i18n, customer-auth 14/14, focused strict renderer TypeScript, scoped lint, and committed
  diff checks passed. The scoped lint's normal configuration retains one unchanged JavaScript-helper
  return-type baseline; all task changes pass with that inapplicable rule excluded.
- Independent review's only initial P3 was the English-only Omni tooltip. After `931b81b`, re-review
  found no open P1, P2, or P3 issue; see
  [`desktop-update-menubars-009-1`](../reviews/desktop-update-menubars-009-1.md).
- Electron launch, build, packaging, signing, notarization, publication, upload, CDN refresh, and
  remote feed access were intentionally not run. Ral owns real-device visual/update acceptance.

## Owner correction — 2026-07-31

- Correct the shared compact Menu Bar label spelling to `update` in Home, Maestro, and
  top-level Omni without changing its layout, styling, readiness behavior, or ownership boundary.
