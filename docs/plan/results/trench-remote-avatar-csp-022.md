# Trench remote wallet avatar CSP and fallback result

## Outcome

The Coin/Trench renderer now admits provider-supplied HTTPS wallet images while retaining every
non-image CSP restriction. A wallet row with an avatar URL always owns one 28px circular local
initial; the remote image covers it only while that URL loads successfully. A failed URL is hidden
for the rest of the current renderer lifetime, so an origin rejection such as GMGN HTTP 403 cannot
leave a broken-image glyph or start a retry loop.

No image proxy, cache, scripted fetch, IPC/XPC method, SQLite column, metadata mutation, INDEX
analysis change, GMGN process change, or MCP change was added.

Implementation status: **implemented; owner verification pending**. Review 1's two P2 findings are
fixed in source and deterministic unit/static coverage. Per owner direction, Electron E2E is no
longer a completion gate for this handoff; Ral will test standalone/Omni behavior. An automated
DEBUG_DEV run had already finished before that direction arrived, but it is not treated as owner
acceptance and no further Electron run was started.

## Implementation

- `src/renderer/coin/index.html` changes exactly one directive from
  `img-src 'self' data:` to `img-src 'self' data: https:`. Plain HTTP remains absent;
  `connect-src`, script, object, frame, base, and form policy remain locked.
- `trenchIndexAvatar.ts` derives exactly one Unicode code point from trimmed wallet name, then the
  canonical address without an EVM `0x` prefix. It applies locale-independent uppercase only when
  the mapping remains one code point, so `i` becomes `I`, expanding `ß` remains `ß`, and emoji stay
  intact. It also owns pure immutable helpers for deciding whether a URL remains renderable and
  recording a failed URL.
- A row with `avatarUrl` renders one 28px circular wrapper with the local initial underneath. The
  decorative image keeps `alt=""` and `referrerpolicy="no-referrer"`; its `error` event replaces
  the renderer-lifetime failed-URL set and removes that image node. A row without a URL renders no
  wrapper and reserves no avatar space.
- The Electron fixture now contains assertions for standalone and a real 800x568 Omni view: BSC
  selects the failed HTTPS avatar, its 28px fallback remains visible, the image node is removed,
  root overflow stays zero, and that renderer does not repeat the request across tab switches.
  These assertions are retained for future/owner-triggered use; owner acceptance remains pending.

## Verification

- PASS — `node tests/coin/run-unit.mjs`: 148/148, including deterministic name/address initials,
  `i`, expanding `ß`, emoji, empty-name address fallback, and immutable renderer-lifetime URL
  failure state.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: 6/6 native repository integration tests.
- PASS — focused Trench renderer `vue-tsc` through
  `tests/coin/tsconfig.trench-renderer.json`.
- PASS — fresh isolated DEBUG_DEV `yarn build` completed before the owner stop direction.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: 14/14. Source and fresh built
  Coin CSP contain exact `img-src 'self' data: https:`; the Todo source/built renderer still has
  only `img-src 'self' data:`; every locked Coin directive remains present.
- PASS — `git diff --check`.
- PENDING — owner standalone/Omni acceptance. Per Ral's instruction, no further Electron E2E will
  run; the task must not be marked Verify pass, done, or complete from automated evidence.

The completed build used DEBUG_DEV. The running DEBUG_PROD process and profile remained active and
untouched.
