---
id: motto-miniapp-001-3
status: pass
reviewed_task: motto-miniapp-001
date: 2026-07-31
review_type: independent-static-targeted-and-build
---

# Motto Mini App Review 3

## Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

The Header Add icon-only follow-up matches `docs/features/motto.md:38-41` and
`docs/plan/tasks/motto-miniapp-001.md:51-52`. Review 2 remains authoritative for the optional
Subtitle follow-up.

## Accepted Evidence

### Header Add action

- The fixed Header uses the shared `IconBtn`, retains the stable `name="motto__add"` and
  `class="motto__add"` hooks, and contains only an `IconPlus`; no visible localized Add text
  remains inside the Header control (`src/renderer/motto/src/App.vue:3-14`).
- The Header control forwards the localized `i18nHelper.motto.add` value through both `title` and
  `aria-label`, while the plus icon is explicitly presentation-only with `aria-hidden="true"`
  (`src/renderer/motto/src/App.vue:5-13`). English and Chinese keep localized Add labels
  (`src/renderer/common/i18n/en.ts:305-307`,
  `src/renderer/common/i18n/zh.ts:306-308`).
- The shared control forwards attributes onto a native Arco button and owns a fixed 32 x 32 click
  area with zero padding. Both the button and its Arco icon wrapper use flex alignment on both axes
  (`src/renderer/common/components/IconBtn/IconBtn.vue:8-18`,
  `src/renderer/common/components/IconBtn/IconBtn.less:1-12`, `:35-41`). Motto's local class
  preserves the same fixed dimensions and explicit horizontal/vertical centering
  (`src/renderer/motto/src/App.less:36-44`).
- The empty-state Add action remains a normal primary button with visible localized Add text, so
  only the requested Header action became icon-only (`src/renderer/motto/src/App.vue:67-77`).

### Regression coverage

- The editor still requires only trimmed Title. Subtitle remains optional in the form and an empty
  Subtitle remains absent from card rendering (`src/renderer/motto/src/App.vue:39-40`, `:98-118`;
  `src/renderer/motto/src/store/motto.store.ts:27`, `:67-78`).
- Storage validation still requires the `subtitle` field to exist as a string but accepts and
  persists its trimmed empty value. Whole-array persist-before-commit behavior is unchanged
  (`src/renderer/motto/src/store/mottoStorage.service.ts:26-64`, `:108-122`;
  `src/renderer/motto/src/store/motto.store.ts:91-106`).
- The targeted integration test guards shared `IconBtn` use, localized accessible names, hidden
  plus semantics, no Header Add text, visible empty-state Add text, fixed dimensions, and
  two-axis centering. The storage suite continues to cover the optional empty Subtitle contract
  (`tests/motto/mottoIntegration.test.mjs:71-112`,
  `tests/motto/mottoStorage.test.mjs:44-51`, `:110-132`).

### Package integrity

- The unrelated owner package hunk remains exactly `_version: 0.0.57`, `name: Bitterless`,
  `version: 0.0.57`, and `version_code: 260731140324`; each key occurs exactly once
  (`package.json:3`, `:240-242`). The Header follow-up did not modify package metadata.

## Verification

- `yarn test:motto` — PASS, 18/18.
- `yarn exec vue-tsc --noEmit -p tests/motto/tsconfig.web.json --composite false` — PASS.
- `yarn eslint --no-cache src/preload/motto src/renderer/motto tests/motto` — PASS with 0 errors
  and 0 warnings.
- Package JSON parse, owner-version value, and key-uniqueness audit — PASS.
- `yarn build` — PASS; the build emitted `out/preload/motto.js` and
  `out/renderer/motto/index.html`.
- `git diff --check` — PASS.

No interactive Electron UI session was run. Static inspection covers the actual shared button and
compiled style path; targeted tests, scoped type/lint checks, and the full production build cover
the changed renderer boundary.

## Conclusion

**pass**

No P1, P2, or P3 finding remains. The Header Add icon-only change is ready for delivery.
