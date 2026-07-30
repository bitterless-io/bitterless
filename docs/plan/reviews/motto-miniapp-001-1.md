---
id: motto-miniapp-001-1
status: pass
reviewed_task: motto-miniapp-001
date: 2026-07-29
review_type: independent-static-and-build
---

# Motto Mini App Review 1

## Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

The implementation matches `docs/features/motto.md`,
`docs/features/omni-miniapp-cells.md`, and the task verification contract.

## Accepted Evidence

### Storage and state

- `src/renderer/motto/src/store/mottoStorage.service.ts:1` uses the exact
  `bitterless.motto.items.v1` key. One whole-value read distinguishes a missing key, an unavailable
  store, malformed JSON, and an invalid payload (`:75`); one whole-array write validates before
  calling `setItem` (`:97`).
- Runtime validation requires an array of objects containing exactly `id`, `title`, and `subtitle`;
  all three values are trimmed non-empty strings, and IDs remain unique after trimming
  (`src/renderer/motto/src/store/mottoStorage.service.ts:26`, `:56`).
- Initialization fails closed to an empty collection and retains a typed localized error
  (`src/renderer/motto/src/store/motto.store.ts:31`). Add appends a generated UUID, Edit maps the
  selected ID in place, and Delete filters the selected ID (`:67`, `:88`, `:111`).
- Every mutation creates the complete next collection, persists it, and only then assigns the
  reactive collection. A thrown write records `write-failed` and returns without committing the
  candidate state (`src/renderer/motto/src/store/motto.store.ts:93`).

### Renderer contract

- The fixed header owns the primary Add action; the remaining region owns a one-column scrolling
  card list or centered empty state
  (`src/renderer/motto/src/App.vue:3`, `src/renderer/motto/src/App.less:17`, `:45`, `:51`).
  The conditional Arco alert preserves the last safe collection while surfacing storage failures
  (`src/renderer/motto/src/App.vue:17`).
- Each card has a focusable `IconBtn` ellipsis backed by an Arco dropdown with immediate Edit and
  Delete options (`src/renderer/motto/src/App.vue:44`). The editor uses an Arco modal/form with
  prefilled edit drafts, required Title and Subtitle fields, trimmed submit eligibility, Title
  autofocus, Enter handling, cancel/close/Esc discard behavior, and normal Arco Tab navigation
  (`src/renderer/motto/src/App.vue:81`, `:99`, `:110`;
  `src/renderer/motto/src/store/motto.store.ts:23`, `:46`, `:53`, `:60`).
- Renderer labels, accessible names, empty/error copy, and form copy are shared in both English and
  Chinese. Language initialization finishes before the UI module is evaluated
  (`src/renderer/common/i18n/en.ts:224`, `:262`;
  `src/renderer/common/i18n/zh.ts:225`, `:263`;
  `src/renderer/motto/src/main.ts:9`).
- The renderer uses Arco controls, Tabler icons, sibling Less, shallow business BEM, wrapping text,
  and a constrained-pane media rule. No Tailwind or atomic utility classes are present
  (`src/renderer/motto/src/App.vue`, `src/renderer/motto/src/App.less`).

### Omni runtime integration

- Motto is the fourth value in the shared mini-app allowlist and therefore passes through the same
  bounded layout parser used by Control and Main
  (`src/shared/omni/omni.types.ts:12`, `:48`, `:188`, `:229`).
- Omni Control renders exactly four typed choices and adds the localized Motto selector with its
  dedicated asset (`src/renderer/omni/omniControl/src/components/OmniPane.vue:34`, `:55`).
- Main maps Motto to `motto.js` and the `motto` renderer. The generic mini-app path resolves the
  generated preload from `app.getAppPath()/out`, uses the Vite development URL or packaged
  `loadFile` target, keeps the default Electron session, and applies the existing privileged
  `setWindowOpenHandler` plus `will-navigate` fence
  (`src/main/windows/omniWindow.helper.ts:117`, `:603`, `:615`, `:631`, `:736`, `:775`).
- Electron Vite has dedicated Motto preload and renderer entries, and the production build emitted
  both `out/preload/motto.js` and `out/renderer/motto/index.html`
  (`electron.vite.config.ts:163`, `:203`).
- The restored documentation consistently names four Omni mini apps and correctly distinguishes
  service-backed live synchronization from Motto's same-origin, next-load localStorage behavior
  (`docs/features/omni-miniapp-cells.md:7`, `:97`, `:158`;
  `docs/features/motto.md:71`).

### Tests and package integrity

- `tests/motto/mottoStorage.test.mjs` behaviorally covers missing, valid, malformed, duplicate-ID,
  invalid/extra-field, unavailable-read, complete-write, and failed-write cases.
- `tests/motto/mottoIntegration.test.mjs` guards the shared parser, fourth selector, dedicated
  runtime/build mappings, navigation fence reuse, persist-before-commit ordering, UI interactions,
  i18n initialization, BEM/Less, and Tailwind absence.
- The unrelated owner version hunk remains intact as `Bitterless 0.0.49` with
  `version_code: 260729105455`. `_version`, `name`, `version`, and `version_code` each occur exactly
  once at the top level, and `test:motto` is present once (`package.json:3`, `:37`, `:237`).

## Verification

- `yarn test:motto` — PASS, 17/17.
- `yarn exec vue-tsc --noEmit -p tests/motto/tsconfig.web.json --composite false` — PASS.
- `yarn check:renderer-i18n` — PASS.
- `yarn test:omni-layout` — PASS, 8/8.
- `yarn typecheck:node` — PASS.
- `yarn eslint --no-cache src/preload/motto src/renderer/motto tests/motto` — PASS with 0 errors
  and 0 warnings.
- Scoped ESLint over every touched implementation/integration path — PASS with 0 errors; it reports
  631 non-blocking Prettier warnings while checking complete legacy-style shared files. The new
  Motto paths above are clean.
- `yarn build` — PASS; the dedicated preload and packaged renderer targets exist.
- Package JSON parse, version-key uniqueness, and build-target existence audit — PASS.
- `git diff --check` — PASS.
- `yarn typecheck:web` — baseline-blocked by existing errors in Connector, Coin, Poker, Home,
  Maestro, Omni Window, EyesOnAgents, and shared path-helper code. No diagnostic references Motto,
  its i18n additions, the shared Omni parser, or the changed Omni Control component.

## Conclusion

**pass**

No P1, P2, or P3 finding remains. The task is ready for delivery. Verification covered source,
contract tests, scoped type/lint checks, the existing Omni layout suite, and a complete production
build; no interactive Electron UI/E2E session was run.
