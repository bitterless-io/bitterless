---
id: maestro-local-home-branding-008
scope: fixed Maestro Home rail visibility and Bitterless Home/New-tab branding
status: implemented; owner verification pending
depends-on: [maestro-local-home-navigation-007]
verify: node --test tests/maestro/maestroLocalHomeBranding.test.mjs && yarn typecheck:node && yarn check:maestro && git diff --check
---

# Simplify the fixed Home rail and use Bitterless branding

## Objective

Hide the Settings button from the fixed Home tab's left rail. Replace the pinned Home tab favicon
and the centered blank New-tab splash logo with the Bitterless application icon, while preserving
all existing routes, Workbench controls, generic web-tab fallbacks, and Maestro window behavior.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-local-home-still-shows-chat.md`
- `docs/features/desktop-app-icon.md`
- `docs/plan/tasks/maestro-local-home-navigation-007.md`

## Layout contract

```text
┌─ Maestro fixed Home operation surface ───────────────────────────────┐
│ ┌─ 56px rail ─┬────────────────────────────────────────────────────┐ │
│ │ Mini Apps ● │ Mini Apps grid                                    │ │
│ │ Connector   │                                                   │ │
│ │             │                                                   │ │
│ │             │ no Settings footer button                         │ │
│ └─────────────┴────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘

┌─ tab strip ──────────────────────────────────────────────────────────┐
│ [ Bitterless icon · Home ] [ generic/page favicon · browser tab ]   │
└──────────────────────────────────────────────────────────────────────┘

Blank New tab body: centered 56px Bitterless icon; no Maestro `M` logo.
```

## Path

- `src/renderer/maestro/localHome/src/components/LocalHomeMenu.vue`
- `src/renderer/maestro/localHome/src/localHome.less`
- `src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue`
- `src/renderer/maestro/home/src/views/layout/Layout.vue`
- `src/renderer/maestro/common/assets/icons/bitterless-icon.png` (new generated runtime asset)
- `tests/maestro/maestroLocalHomeBranding.test.mjs` (new)
- `docs/features/maestro.md`
- `docs/issues/maestro-local-home-still-shows-chat.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Remove only the visible Settings footer action from `LocalHomeMenu.vue`. Keep the dedicated
  `setting` route and its local-only behavior intact; do not change Workbench Settings.
- Keep Mini Apps and Connector geometry, keyboard behavior, localized labels, selected state, and
  the 56px rail unchanged. Remove CSS that exists only for the retired Settings footer.
- Use the canonical Bitterless artwork owned by `build/icon.png`. The repository already contains
  the script-generated `doc/app_icons/icon64.png`; copy that exact generated asset into the Maestro
  runtime asset directory rather than creating new artwork or bundling the 1024px source.
- Use that one bundled asset for both the fixed Home tab icon and the 56px blank New-tab splash.
  Do not replace Maestro logos in Workbench/About or change arbitrary web-tab favicon/fallback logic.
- Preserve tab sizing, title, close/pin behavior, blank-tab lifecycle, renderer geometry, navigation,
  preload/partition ownership, and all Main/XPC contracts.

## Verification

- A focused source/asset test proves the Settings rail action/footer is absent, the `setting` route
  remains registered, both intended UI sites import the Bitterless asset, generic web-tab fallback
  remains intact, and the bundled asset is byte-identical to `doc/app_icons/icon64.png`.
- Run `yarn typecheck:node`, `yarn check:maestro`, and `git diff --check`.
- Do not launch Electron, Playwright/E2E, or the packaged application. Ral owns the final visual
  acceptance in the real Maestro window.

## Delivery

- Removed the fixed local Home rail's Settings footer action and footer-only CSS while preserving
  the dedicated local `setting` route.
- Added one 64px `bitterless-icon.png`, byte-identical to the existing canonical-script output, and
  used it for both the pinned Home tab favicon and the centered blank New-tab splash.
- Preserved Workbench/About's Maestro logo and arbitrary web-tab page/generic favicon behavior.
- [Independent review 1](../reviews/maestro-local-home-branding-008-1.md): **PASS**, no P1/P2/P3
  findings.
- Focused source/asset test: **PASS, 6/6**. `yarn typecheck:node`, debug `yarn build`, asset hash,
  and `git diff --check`: **PASS**. The build emits the new `bitterless-icon` renderer asset.
- `yarn check:maestro` remains blocked before its parity scripts by the existing repository-wide
  Maestro host-alias audit baseline; the task's two new asset imports use the accepted alias and
  add no reported violation.
- Electron, Playwright/E2E, real-app visual verification, and packaged smoke were intentionally not
  run. Ral owns final visual acceptance.
