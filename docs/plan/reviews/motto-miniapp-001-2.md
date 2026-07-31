---
id: motto-miniapp-001-2
status: pass
reviewed_task: motto-miniapp-001
date: 2026-07-31
review_type: independent-static-targeted-and-build
---

# Motto Mini App Review 2

## Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

The optional-Subtitle follow-up matches `docs/features/motto.md:56-60` and
`docs/features/motto.md:70-77`. This review supersedes Review 1 only where its original
required-Subtitle evidence is now historical.

## Accepted Evidence

### Editor and card behavior

- Title remains required after trimming: `canSubmitEditor` depends only on
  `draftTitle.trim()`, and `submitEditor` rejects an empty trimmed Title
  (`src/renderer/motto/src/store/motto.store.ts:27`, `:67`).
- Subtitle is trimmed but is not a submission prerequisite. Both Add and Edit pass that trimmed
  value into their next item, so either path persists `subtitle: ''` when the input is omitted or
  whitespace-only (`src/renderer/motto/src/store/motto.store.ts:67`, `:73`, `:78`).
- The Title form item remains required, the Subtitle form item no longer has `required`, and the
  submit button remains bound to the Title-only `canSubmitEditor` predicate
  (`src/renderer/motto/src/App.vue:99`, `:110`, `:124`).
- Cards conditionally render the Subtitle paragraph, so an empty Subtitle does not leave an empty
  `<p>` in the card (`src/renderer/motto/src/App.vue:39`).

### Persistence contract

- Every stored item must still contain exactly `id`, `title`, and `subtitle`; all three fields must
  still be strings. Only `id` and `title` are rejected after trimming to empty, while `subtitle` is
  returned as its trimmed string, including `''`
  (`src/renderer/motto/src/store/mottoStorage.service.ts:26`, `:34`, `:43`, `:54`).
- Whole-array persistence still validates and serializes that normalized three-field shape before
  writing (`src/renderer/motto/src/store/mottoStorage.service.ts:108`).
- Executable storage tests cover whitespace-only Subtitle load normalization and empty-Subtitle
  whole-array persistence (`tests/motto/mottoStorage.test.mjs:44`, `:104`). A separate direct
  read-after-write probe confirmed that the empty string and the `subtitle` key round-trip, while a
  missing `subtitle` field remains rejected.
- The integration contract guards Title-only submit eligibility, Subtitle trimming, both Add/Edit
  item writes, absence of the Subtitle `required` marker, and conditional card rendering
  (`tests/motto/mottoIntegration.test.mjs:48`, `:71`).

### Package integrity

- The unrelated owner version hunk remains exactly `_version: 0.0.57`, `name: Bitterless`,
  `version: 0.0.57`, and `version_code: 260731140324`; each key occurs exactly once
  (`package.json:3`, `:240`). The optional-Subtitle implementation did not add a package hunk.

## Verification

- `yarn test:motto` — PASS, 18/18.
- `yarn exec vue-tsc --noEmit -p tests/motto/tsconfig.web.json --composite false` — PASS.
- `yarn eslint --no-cache src/preload/motto src/renderer/motto tests/motto` — PASS with 0 errors
  and 0 warnings.
- `yarn check:renderer-i18n` — PASS.
- Direct storage empty-Subtitle persist/read round-trip plus missing-field rejection probe — PASS.
- Package JSON parse, owner-version value, and key-uniqueness audit — PASS.
- `yarn build` — PASS; the build emitted `out/preload/motto.js` and
  `out/renderer/motto/index.html`.
- `git diff --check` — PASS.

No interactive Electron UI session was run. The scoped Vue typecheck, source interaction tests, and
full production build cover the changed renderer/store boundary.

## Conclusion

**pass**

No P1, P2, or P3 finding remains. The optional-Subtitle change is ready for delivery.
