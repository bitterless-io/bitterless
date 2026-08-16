---
id: trench-remote-avatar-csp-022
scope: BL Trench INDEX wallet avatars
status: done
depends-on: [trench-gmgn-electron-argv-021]
---

# Trench remote wallet avatar CSP and fallback

## Objective

Allow the Coin/Trench renderer to display provider-supplied HTTPS wallet avatars without loosening
any non-image renderer capability. When a permitted remote source still rejects or cannot serve the
image, render a deterministic local initial instead of a broken-image glyph.

## Context

- [`../../features/trench-index.md`](../../features/trench-index.md)
- [`../../features/trench-index-layout.md`](../../features/trench-index-layout.md)
- [`../analysis/trench-index-analysis.md`](../analysis/trench-index-analysis.md)
- [`trench-gmgn-electron-argv-021.md`](trench-gmgn-electron-argv-021.md)

The current branch is `dev/current`; do not switch or create a branch/worktree. Preserve unrelated
dirty changes. Keep DEBUG_PROD running and untouched. Build and Electron verification use isolated
DEBUG_DEV state only.

## Path

- `docs/features/trench-index.md`
- `docs/features/trench-index-layout.md`
- `docs/plan/analysis/trench-index-analysis.md`
- `docs/plan/tasks/trench-remote-avatar-csp-022.md`
- `docs/plan/results/trench-remote-avatar-csp-022.md`
- `docs/plan/README.md`
- `src/renderer/coin/index.html`
- `src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue`
- `src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.less`
- a sibling pure avatar helper only if it materially improves deterministic testing
- focused Coin renderer/static/Electron tests required by this contract

## Contract

1. The Coin/Trench renderer CSP changes only its image directive, from
   `img-src 'self' data:` to exact `img-src 'self' data: https:`. Plain HTTP, arbitrary connection,
   script, object, frame, base, and form capabilities remain blocked. No other renderer CSP changes.
2. `avatarUrl` remains the bounded HTTPS URL joined from `trench_wallets`. This task does not add an
   image downloader, proxy, cache, blob column, new IPC/XPC method, or renderer-side scripted fetch.
3. A row with `avatarUrl` uses the existing 28px circular footprint. A deterministic local initial
   derived from the wallet name, then canonical address, sits behind the image. It is the source's
   first Unicode code point after trimming and EVM-prefix removal. Locale-independent uppercase is
   used only when it remains exactly one code point; expanding mappings keep the original code
   point. The image remains decorative (`alt=""`) and sends no referrer.
4. An image `error` hides that failed URL for the current renderer lifetime and exposes the local
   initial. It must not retry automatically, show a broken-image glyph, clear metadata, or mutate
   SQLite. A row without `avatarUrl` continues to reserve no avatar block.
5. CSP admission does not claim that a remote origin will serve the URL. A real GMGN-hosted avatar
   returning HTTP 403 is a successful fallback case, not evidence that metadata extraction failed.
6. INDEX analysis, GMGN process/credential handling, hidden `trench-io` storage, ranking, schema,
   migrations, public XPC, and the exact 12 `trench.*` MCP tools remain unchanged.

## Verification

- Static source and fresh built-output assertions prove the Coin CSP contains exact
  `img-src 'self' data: https:` while all other directives remain, HTTP is not admitted, and another
  renderer CSP is unchanged.
- Focused renderer tests prove deterministic name/address initials, no reserved block without a URL,
  a successful HTTPS image overlay, and an error transition to fallback with no automatic request or
  mutation.
- Fresh isolated DEBUG_DEV build plus deterministic component/static coverage prove the rejected
  HTTPS-avatar fallback contract. Per owner direction, no further Electron E2E is an automated
  completion gate; standalone/Omni rendering is handed to Ral for manual acceptance.
- Renderer typecheck, relevant Coin/static tests, i18n/Omni/MCP compatibility checks, `git diff
  --check`, and independent Verify review pass. DEBUG_PROD stays running and untouched.

## Develop checkpoint

Review 1's deterministic-single-code-point and Omni rejected-avatar findings are fixed.
The implementation and fast unit/static/type verification are complete. Per owner direction, no
further Electron E2E will run in this task; standalone/Omni owner acceptance remains pending and
does not block source delivery.
Evidence is recorded in
[`../results/trench-remote-avatar-csp-022.md`](../results/trench-remote-avatar-csp-022.md); the task
is source-complete; standalone/Omni visual acceptance remains with the owner.
