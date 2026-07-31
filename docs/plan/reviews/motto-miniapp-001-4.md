---
id: motto-miniapp-001-4
status: pass
reviewed_task: motto-miniapp-001
date: 2026-07-31
review_type: independent-static-targeted-and-build
---

# Motto Mini App Review 4

## Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

The reminder-card red hierarchy matches `docs/features/motto.md:20-31`,
`docs/design/colors.md:62-74`, and `docs/plan/tasks/motto-miniapp-001.md:53-54`. Review 3 remains
authoritative for the Header Add icon-only follow-up, and Review 2 remains authoritative for the
optional Subtitle follow-up.

## Accepted Evidence

### Card red hierarchy

- Motto declares the exact feature-local tokens `#b42318` and `#a65f59` inside the `.motto` root
  (`src/renderer/motto/src/App.less:1-7`).
- The card's four-pixel left `::before` rule and card title both reference the same
  `--motto-reminder-strong` token (`src/renderer/motto/src/App.less:81-101`). The optional rendered
  subtitle references only `--motto-reminder-muted`
  (`src/renderer/motto/src/App.vue:38-40`,
  `src/renderer/motto/src/App.less:103-110`).
- Static usage inspection finds exactly two strong-token references and one muted-token reference.
  Neither token is applied to the Header, Header Add control, ellipsis menu, editor modal, empty
  state, or page background. Those surfaces retain Royal Blue, neutral, white, or standard Arco
  semantics (`src/renderer/motto/src/App.less:15-46`, `:112-172`). The pre-existing Delete option
  continues to use Arco's semantic `--red-6`; it does not reuse or spread the new reminder palette
  (`src/renderer/motto/src/App.less:119-121`).
- The executable integration contract guards the exact literals, both strong-token consumers, the
  sole muted-token consumer, and the unchanged page/Header/menu colors
  (`tests/motto/mottoIntegration.test.mjs:113-128`).

### Contrast and documented scope

- An independent WCAG relative-luminance calculation gives `#B42318` on white approximately
  6.57:1 and `#A65F59` on white approximately 4.77:1. The documented 4.77:1 muted-subtitle claim is
  accurate and clears the 4.5:1 normal-text threshold used by the 12px subtitle
  (`docs/design/colors.md:69-74`, `src/renderer/motto/src/App.less:103-107`).
- The feature contract keeps the page, card, and border surfaces neutral while limiting the two
  reminder colors to the left rule, title, and optional subtitle
  (`docs/features/motto.md:20-31`).

### Follow-up regression coverage

- Header Add remains an icon-only shared `IconBtn` with localized `title` and `aria-label`; its
  local 32 x 32 rule still centers content on both axes
  (`src/renderer/motto/src/App.vue:3-14`, `src/renderer/motto/src/App.less:38-46`).
- Title remains the only submission prerequisite. Subtitle is trimmed, may remain empty, and is
  conditionally omitted from card rendering
  (`src/renderer/motto/src/store/motto.store.ts:27-29`, `:67-80`;
  `src/renderer/motto/src/App.vue:38-40`, `:98-118`).
- Storage still requires the `subtitle` field to exist as a string, accepts its trimmed empty
  value, and persists the complete validated array before state commit
  (`src/renderer/motto/src/store/mottoStorage.service.ts:26-64`, `:108-122`;
  `src/renderer/motto/src/store/motto.store.ts:93-107`).

### Package integrity

- The unrelated owner package hunk remains exactly `_version: 0.0.57`, `name: Bitterless`,
  `version: 0.0.57`, and `version_code: 260731140324`
  (`package.json:3`, `package.json:240-242`). The card-color follow-up does not alter that hunk.

## Verification

- `yarn test:motto` — PASS, 18/18.
- `yarn exec vue-tsc --noEmit -p tests/motto/tsconfig.web.json --composite false` — PASS.
- `yarn eslint --no-cache src/preload/motto src/renderer/motto tests/motto` — PASS with 0 errors
  and 0 warnings.
- Independent exact-token usage and WCAG contrast audit — PASS; strong 6.57:1 and muted 4.77:1
  against the white card surface.
- Package JSON value audit — PASS; the recorded `0.0.57` owner hunk is unchanged.
- `yarn build` — PASS; it emitted `out/preload/motto.js` and
  `out/renderer/motto/index.html`.
- `git diff --check` — PASS.

The tests emitted the existing Node typeless-package warning for direct TypeScript ESM imports, and
the build emitted existing mixed dynamic/static import warnings; neither is introduced by this
CSS-only follow-up and both commands completed successfully. No interactive Electron UI session was
run.

## Conclusion

**pass**

No P1, P2, or P3 finding remains. The Motto card title, left rule, and optional subtitle now use the
requested scoped red hierarchy without changing unrelated controls, persistence behavior, or the
owner package hunk.
