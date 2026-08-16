# Review: trench-remote-avatar-csp-022

## Findings

- **P1 · blocking:** None open.
- **P2 · blocking:** None open.
- **P3 · non-blocking:** None open.

## Resolved during Verify

- **Resolved P2 — fallback determinism and exact-one-code-point contract.** The original helper
  called host-locale `toLocaleUpperCase()`, so `i` could differ by system locale and `ß` expanded to
  `SS`. `src/renderer/coin/src/components/TrenchIndexWorkspace/trenchIndexAvatar.ts:5-9` now first
  selects exactly one source code point, applies locale-independent `toUpperCase()`, and accepts the
  uppercase form only when it remains exactly one code point; otherwise it keeps the original.
  `tests/coin/unit/trenchIndexAvatar.test.ts:9-18` proves trimmed-name priority, empty-name EVM
  address fallback, Solana-style address fallback, locale-sensitive `i -> I`, expanding `ß -> ß`,
  emoji preservation, exact code-point counts, and the missing-source error. The focused renderer
  typecheck and project unit runner pass.
- **Resolved P2 — Omni rejected-avatar evidence.** The original Electron source verified the
  rejected HTTPS avatar only in standalone and left every Omni view on avatar-free SOL. The current
  source adds `expectRejectedAvatarAt` at
  `tests/coin/specs/trench-index.spec.ts:147-182`, which checks an actual view's local `F` fallback,
  missing image node, fallback visibility, exact 28px footprint, and zero root overflow. The
  800x568 Omni flow at `tests/coin/specs/trench-index.spec.ts:424-444` now switches the real view to
  BSC, waits for exactly one avatar request, applies those assertions, switches SOL -> BSC, repeats
  the DOM assertions, and proves the renderer did not retry the URL. Per Ral's amended verification
  contract, this source is retained for manual/future execution; no Electron E2E execution or owner
  visual acceptance is required for source delivery and none was run during this re-review.

## Verified behavior

- The Coin source and prior fresh DEBUG_DEV output contain exact
  `img-src 'self' data: https:`. Plain HTTP is absent; connection, script, object, frame, base, and
  form restrictions remain locked. No other source renderer HTML was widened.
- `avatarUrl` remains a bounded credential-free HTTPS URL joined from `trench_wallets`. The
  renderer adds no fetch, IPC/XPC, SQL, metadata mutation, downloader, proxy, cache, or retry path.
- No URL means no avatar wrapper. A URL means one 28px local fallback behind the decorative
  `alt=""` / `no-referrer` image. The immutable renderer-local failed-URL set removes a failed image
  node and suppresses that URL for the renderer lifetime.
- The public MCP schema remains the exact same 12 `trench.*` tools.

## Independent verification evidence

- PASS — `node tests/coin/run-unit.mjs`: 148/148, including the repaired `i`, `ß`, emoji, and
  address-fallback cases.
- PASS — focused Trench renderer `vue-tsc`.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: 14/14, including source/current
  built CSP and avatar structure assertions.
- PASS — prior independent evidence remains valid for native repository 6/6, Node/MCP typechecks,
  renderer i18n, Omni embedding, exact 12-tool compatibility, fresh isolated DEBUG_DEV build, and
  `git diff --check`.
- INFO — an attempted direct `node --import tsx` invocation failed because this project does not
  install `tsx`; the authoritative esbuild-based project unit runner above then passed 148/148.
- NOT RUN by owner direction — no build, Electron E2E, screenshot capture, or DEBUG_PROD command was
  started during this re-review. Standalone/Omni visual acceptance remains a non-blocking manual
  handoff to Ral under the amended task contract.

## Conclusion

**pass** — both original P2 findings are resolved in source and deterministic unit/static/type
evidence. The HTTPS-only CSP widening and renderer-lifetime fallback meet the amended source
contract; no open P1/P2/P3 finding remains. Owner standalone/Omni acceptance is pending but does
not block task 022 source delivery.
