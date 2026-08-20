---
id: miniapp-menubar-alignment-002
scope: omni-translator and omni-motto embedded MenuBar
status: implemented
depends-on: [translator-miniapp-001, motto-miniapp-001]
---

# Objective

Replace Translator's and Motto's 44px light app headers with the established EyesOnAgents MenuBar
effect already shared by the Todo and Submodules mini apps: one 32px Royal Blue bar with a leading
16px identity icon, a 13px/650 title, light chrome ink, a dark bottom divider, and 27px light
action controls. Keep every existing Translator and Motto behavior, business logic, i18n key,
stable `name` hook, and content-region palette unchanged.

# Context

- `docs/features/translator.md`
- `docs/features/motto.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/design/colors.md`
- `docs/plan/tasks/onlypreview-menubar-003.md` — same alignment performed for the standalone
  OnlyPreview window
- Reference implementations: `src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/`,
  `src/renderer/submodules/src/components/SubmodulesMenuBar/`,
  `src/renderer/todo/src/components/MenuBar/`

# Path

- `src/renderer/translator/src/App.vue`
- `src/renderer/translator/src/App.less`
- `src/renderer/motto/src/App.vue`
- `src/renderer/motto/src/App.less`
- `tests/motto/mottoIntegration.test.mjs`
- `docs/features/translator.md`
- `docs/features/motto.md`
- `docs/plan/README.md`
- `docs/plan/tasks/miniapp-menubar-alignment-002.md`

# Implementation Constraints

1. Follow the EyesOnAgents chrome contract by copy, not by import: neither mini app may import the
   private `EyesOnAgentsMenuBar` component, its store, emitter, or window behavior.
2. Translator and Motto run only as Omni mini-app cells. Reproduce the EyesOnAgents `--omni`
   variant only — `0 10px` padding, `-webkit-app-region: no-drag`, no macOS traffic-light gutter,
   no drag region, no minimize/maximize/close/always-on-top controls, no double-click maximize.
3. Chrome values match the reference bars exactly: `32px` height and `min-height`, `#4E5882`
   background, `1px solid #3D4666` bottom divider, `#F6F7FC` ink, `7px` identity gap, 16px leading
   Tabler icon, 13px/650 title with `0.01em` letter spacing and ellipsis overflow, `4px` action
   gap, `27px` square Arco text buttons whose hover/focus state is `#FFF` on `rgb(255 255 255/15%)`.
4. Translator keeps its fixed provider/model label in the bar as a compact chip on the reference
   `24px` / `12px`-radius / `rgb(255 255 255/8%)` / `rgb(255 255 255/18%)`-border chip treatment,
   still using the monospace metadata stack. No provider selector is introduced.
5. Motto keeps exactly one icon-only Add action with its localized `title`/`aria-label` and no
   visible label. Inside the dark bar it uses the reference `size="mini"` Arco text button instead
   of the light-surface shared `IconBtn`; the card `[…]` menu keeps `IconBtn` unchanged.
6. Only chrome changes. The translation canvas, result footer, error strip, rail, composer, card
   list, empty state, editor modal, storage, and every store method stay as they are, including
   Motto's red reminder palette staying out of the chrome.
7. Keep `translator`/`motto`-rooted BEM classes, at most two `__` separators, styles in the sibling
   `.less`, and no Tailwind or atomic utility classes. Rename the two headers to the
   `<app>-menu-bar` block plus `<app>__menuBar` name hooks used by the reference bars, and update
   the source-text assertions that pin the old header hooks.

# Verification

- `node --test tests/motto/mottoIntegration.test.mjs` and the Translator renderer source tests
  (`tests/translator/translatorCopy.test.mjs`, `tests/translator/translatorRetry.test.mjs`).
- `yarn typecheck:node` (and renderer typecheck if the project exposes one).
- `yarn check:renderer-i18n` — no new key is expected; the check must stay green.
- Targeted error-level ESLint over the four touched renderer sources.
- `git diff --check`.
- No Electron E2E, packaged run, or app launch per the workspace Electron rule; owner performs the
  visual check that both bars are indistinguishable in height, color, divider, typography, and
  control sizing from the EyesOnAgents and Submodules bars in an Omni cell.

# Outcome

- Translator's header is now `translator-menu-bar`: a 32px Royal Blue bar with a 16px `IconLanguage`
  identity, the 13px/650 title, and the fixed `Codex · 5.5 · low` label as the 24px chip. Its
  `chrome` / `chrome-line` / `chrome-ink` tokens carry the exact reference hexes, because the
  pre-existing oklch `royal` token resolves to `#4E5677` rather than `#4E5882`.
- Motto's header is now `motto-menu-bar`, reusing its already-exact `--motto-royal` hex plus new
  `chrome-line` / `chrome-ink` tokens, with a 16px `IconNotes` identity and the Add action moved
  from the light-surface `IconBtn` to the reference 27px Arco text button. The card `[…]` menu still
  uses `IconBtn`.
- Both bars are Omni-embedded only: `no-drag`, no traffic-light gutter, no window controls.
- Content regions, stores, i18n keys, and Motto's red card palette are untouched.
- Verified: `node --test tests/motto/mottoIntegration.test.mjs tests/translator/translatorCopy.test.mjs
tests/translator/translatorRetry.test.mjs` (15/15), `yarn check:renderer-i18n`, `yarn typecheck:node`,
  ESLint on the touched sources, `git diff --check`, Prettier. `yarn typecheck:web` still fails on
  this branch, entirely in pre-existing chat/maestro/plugin/pathHelper errors — none in
  `renderer/translator`, `renderer/motto`, or `shared/translator`. No Electron E2E was run.
