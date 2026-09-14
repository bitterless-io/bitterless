# OnlyPreview Agent Guide Always Reports "Restart Bitterless"

Status: repaired in `bitterless` and in `micromeet-cowork`'s vendored copy; owner verification pending

## Symptom

Opening the OnlyPreview Agent Guide never reaches the ready state. The card renders its heading and
hint, the copy button stays disabled, and the error block shows:

> **Restart Bitterless** — The setup contract is unavailable or out of date. Restart Bitterless and
> reopen this Guide.

Restarting the application does not change the outcome. No setup instruction can be copied, so the
Guide cannot hand the MCP-plus-skill setup contract to an agent at all.

## Root cause

The Guide payload gained a fourth field but the renderer's exact-shape guard was never widened, so
the guard rejects every well-formed payload Main produces.

- `src/main/miniapps/onlypreview/onlyPreviewAgentSkill.service.ts:116` —
  `createOnlyPreviewAgentSkillGuideInfo` returns four keys: `serverName`, `kind`,
  `skillVersionCode`, `instruction`. `kind` was added on 2026-09-10 (`c9aafd7`) so that Main
  classifies the MCP instance once and the renderer stops comparing `serverName` against product-name
  literals.
- `src/shared/onlypreview/onlyPreview.types.ts:402` — `OnlyPreviewAgentSkillGuideInfo` declares the
  same four fields, including `kind: OnlyPreviewMcpServerKind`.
- `src/renderer/onlypreview/guide/src/onlyPreviewGuide.store.ts:18` — `isExactGuideInfo` still
  demands `Object.keys(record).sort().join(',') === 'instruction,serverName,skillVersionCode'`, the
  three-key set from before `kind` existed. That line was last touched in `f937c9e`, the commit that
  introduced the Guide.

So the actual payload sorts to `instruction,kind,serverName,skillVersionCode`, the equality fails,
`initialize()` throws `Guide contract mismatch`, the `catch` sets `status = 'restart-required'`, and
the template renders the restart block (`App.vue:47`) with the copy button disabled
(`App.vue:33`). The failure is deterministic and independent of process lifetime, which is why
restarting cannot clear it.

`kind` is also never validated — once the key set is widened, the guard must check the value against
`OnlyPreviewMcpServerKind`, otherwise `App.vue:8` and `App.vue:100` branch on an unchecked field.

## Why tests did not catch it

`tests/onlypreview/onlyPreviewAgentSkill.test.mjs:221` asserts Main emits exactly those four keys,
but nothing asserts the renderer guard accepts what Main emits. The contract is tested on one side
only.

Two assertions in that file are separately stale and unrelated to this defect:

- `:313` expects `mcpBridgeServer.configurePreviewOpener(openOnlyPreviewAbsoluteTarget)`, while
  `src/main/app.main.ts` now passes an arrow wrapper carrying `preserveTreeSelection: true`. This
  assertion fails today and aborts the test before reaching the next one.
- `:341` expects `App.vue` to contain `serverName === 'bitterless-preview'`, the pre-`kind` renderer
  branch that `c9aafd7` deliberately removed.

Current state of the suite: 5 tests, 4 pass, 1 fails (`Guide renderer and Main capability wiring
remain narrow and one-card only`).

## Blast radius

`bitterless` live, `micromeet-cowork` latent.

`micromeet-cowork` vendors both files byte-for-byte at
`apps/cowork/src/renderer/onlypreview/guide/src/onlyPreviewGuide.store.ts` and
`apps/cowork/src/shared/onlypreview/onlyPreview.types.ts`, and its own
`createOnlyPreviewAgentSkillGuideInfo` likewise emits `kind` (always `'development'`, from its
host adapter). The Guide there is unreachable for an unrelated and deliberate reason:
`getAgentSkillGuideInfo` calls `mcpHandler.ensureShim()` first, and
`host/onlyPreviewMcpBridge.ensureShim()` always throws because that host exports no MCP bridge. So
the guard never runs today — but the moment Cowork gains a real bridge, as the header comment of
that adapter describes, the same three-key check would reject the payload and reproduce this
failure exactly.

## Repair contract

- Widen `isExactGuideInfo` to the four-key set and validate `kind` against
  `OnlyPreviewMcpServerKind`. Keep the guard exact-shape — an unexpected extra key must still be
  rejected; that strictness is the point of the check.
- Add a renderer-side assertion that the guard's accepted key set equals the key set
  `createOnlyPreviewAgentSkillGuideInfo` actually produces, so the next field added to the contract
  cannot break the Guide silently again.
- Repair the two stale assertions at `:313` and `:341` in the same change, since the suite is the
  gate for this fix and is currently red for unrelated reasons.
- Carry the identical edit into `micromeet-cowork`'s vendored copies and keep them byte-identical.

## What was changed

`bitterless`:

- `src/shared/onlypreview/onlyPreview.types.ts` — `OnlyPreviewMcpServerKind` now derives from a
  runtime tuple `ONLY_PREVIEW_MCP_SERVER_KINDS`, with an `isOnlyPreviewMcpServerKind` guard beside
  it. One source of truth, so a renderer that must check `kind` at runtime does not restate the
  union a third time.
- `src/renderer/onlypreview/guide/src/onlyPreviewGuide.store.ts` — the accepted shape is now the
  named constant `GUIDE_INFO_KEYS` (four keys, alphabetical), and the guard validates `kind` via
  `isOnlyPreviewMcpServerKind` instead of accepting it unchecked.
- `tests/onlypreview/onlyPreviewAgentSkill.test.mjs` — new drift guard asserting
  `GUIDE_INFO_KEYS` equals `Object.keys(production).sort()` from a live
  `createOnlyPreviewAgentSkillGuideInfo` call, plus an assertion that the guard checks `kind`; the
  two stale assertions repaired, and a new `assert.doesNotMatch(guideApp, /serverName === '/)` so
  the renderer cannot drift back to deriving the classification from product-name literals.

`micromeet-cowork`:

- The two vendored files above, copied verbatim (`diff -q` clean against `bitterless`).
- `apps/cowork/tests/unit/onlyPreviewGuideContract.test.mjs` — new; same drift guard against that
  repo's own `createOnlyPreviewAgentSkillGuideInfo`, with the latency of the defect written down so
  whoever implements a Cowork MCP bridge does not rediscover it.

## Verification

- `node --test tests/onlypreview/onlyPreviewAgentSkill.test.mjs` — 5/5 pass (was 4/5).
- Negative check: reverting `GUIDE_INFO_KEYS` to the original three-key set makes the new drift
  guard fail in both repos, so it does catch the bug it was written for.
- `apps/cowork` `yarn test:unit` — 529/536; the 6 failures (`browserCloseShortcut`,
  `onlyPreviewCompositeStartup`, `onlyPreviewRecentsRenderer`) reproduce identically with this
  change reverted and are unrelated to it.
- `vue-tsc` on the Cowork web surface reports the same two pre-existing
  `onlyPreviewShell`/`onlyPreviewTreeSelection` errors with and without this change.
- Electron E2E not run.
