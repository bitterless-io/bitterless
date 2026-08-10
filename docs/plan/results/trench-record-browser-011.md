# Trench Record Browser Verification

Task: `trench-record-browser-011`

Status: **PASS**

Date: 2026-08-09

This was an independent Verify pass against the frozen `docs/features/coin.md`,
`docs/features/coin-layout.md`, `docs/features/trench-mcp.md`, and task 011 contract. Source and
configuration were not edited during verification.

## Verdict

- **Blocker:** none.
- **Important:** none.
- **Nit:** none material to task delivery.

The task can advance as the read-only standalone Trench record browser. Mutation remains MCP-only,
and this verdict does not broaden the repository's task 010 single-Bitterless-Main writer boundary.

## Requirement-by-requirement result

| Requirement | Result | Independent evidence |
|---|---|---|
| Dedicated non-analysis preload | PASS | The standalone window resolves the sandboxed Trench preload. It exposes only frozen host/platform context plus `electron-xpc`; no legacy Coin analysis bridge or callable `contextBridge` API is present. |
| Active import graph excludes legacy capabilities | PASS | The maintained import audit traversed 29 active Trench files and 264 Main files without reaching legacy analysis, data-source, AI, strategy, resource, clipboard, provider, or X-browser runtime from the active Trench graph. |
| Read-only XPC surface | PASS | `TrenchHandler` exposes six list/get methods only. Results are discriminated and bounded; known repository failures keep public codes while unknown failures are sanitized. No renderer or preload mutation route was found. |
| Invalid-record isolation | PASS | Malformed Analysis, Negative tag, and Negative holdings storage decode as `INVALID_STORED_RECORD` without exposing payloads or paths. A valid Negative tag remains readable when holdings are corrupt and carries a separate `holdingsIssue`; strict MCP `getNegativeWallet` behavior is unchanged. Real infrastructure I/O errors continue to propagate rather than being mislabeled as corrupt content. |
| Initial-load and live-refresh races | PASS | The store subscribes before fetching, fences list/detail/query/source generations, and uses independent read and broadcast revision high-watermarks. Tests cover detail revision R after list R-1 followed by broadcast R, duplicate-broadcast dedupe, stale cursor restart, refresh coalescing, selection preservation, and stale response rejection. |
| Truthful refresh state | PASS | Refresh keeps the previously selected persisted evidence visible, labels it as refreshing, and replaces it only after a current successful response. A failed or stale refresh cannot silently blank or overwrite the prior evidence. |
| Three-module UI and bounded layout | PASS | CA Records, Index Wallets, and Negative Wallets each provide list/detail flow. Electron exercised 1360×860 and the 800×600 minimum with independent panes, bounded long identities/hashes, no body overflow, and usable controls. |
| Keyboard and accessibility behavior | PASS | Module selectors expose tab semantics and keyboard navigation, records and actions have accessible names/states, and focus is restored after list refresh or truthful fallback selection. |
| Exact JSON and copy | PASS | Detail copy uses the persisted exact document, not highlighted DOM text. Syntax coloring is bounded by UTF-8 byte length and falls back to exact plain rendering above 128 KiB; multibyte Chinese regression coverage proves the threshold is byte-based. Index source identity/hash is revalidated before source JSON is opened. |
| Keychain-isolated E2E | PASS | The Electron launch prepends macOS `--use-mock-keychain`, uses isolated HOME/userData and an injected isolated 64-hex SQLite runtime password, and installs a fail-closed `safeStorage` tripwire before credential capabilities. The run observed no `.key.bin`, safeStorage call, workspace/keychain credential, unexpected network request, or macOS Keychain permission UI. |
| Target-display Electron acceptance | PASS | The focused run used exact label `DELL S2721QS`; native inspection asserted every visible top-level Electron window was on that display at initial and final boundaries. Routing is E2E-only and fails closed for missing/ambiguous labels. This proves physical-display routing on the display's active macOS Space; Electron does not expose a supported API for directly choosing numbered Space/Desktop 8. |

## Remediation closure during Verify

Independent review found four important correctness gaps before the final run. All were remediated
and independently rechecked:

1. A valid Negative tag no longer becomes unreadable solely because its optional holdings document
   is malformed; the browser reports the holdings issue independently.
2. A detail refresh no longer hides the last valid persisted evidence while the replacement read is
   pending.
3. The large-JSON highlighting threshold now measures UTF-8 bytes rather than JavaScript UTF-16
   code units.
4. Broadcast dedupe no longer shares the read-response revision watermark, so a same-revision
   broadcast still refreshes a list that was read at an older revision.

The final display-routing test also received a lint-only cleanup by replacing its helper function
with a typed-inferred base request constant; no rule suppression was added.

## Commands and results

Passed independently:

- `node tests/coin/run-trench-unit.mjs` — **15/15 passed**.
- `node --test <temporary esbuild bundle of tests/coin/unit/trenchRepository.service.test.ts>` —
  **14/14 passed**.
- `node scripts/mcp/trench-contract.test.mjs` — **passed** through the real stdio helper/local RPC
  contract.
- `yarn tsc -p tests/coin/tsconfig.trench-node.json` — **passed**.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false` — **passed**.
- `yarn typecheck:mcp` — **passed**.
- `yarn typecheck:todoist-sync` — **passed**.
- `node scripts/coin/trench-import-audit.mjs` — **passed**.
- `yarn check:renderer-i18n` — **passed**.
- `yarn tsc -p tests/e2e/tsconfig.strict.json` — **passed**.
- `node --test tests/e2e/e2eDisplayTarget.test.mjs tests/e2e/electronLaunchArgs.test.mjs` —
  **10/10 passed**.
- Focused ESLint over the task 011 Main/preload/shared/renderer/tests and target-display runtime and
  tests — **passed with zero findings**.
- `yarn build` — **passed**.
- `BITTERLESS_E2E_DISPLAY_LABEL='DELL S2721QS' yarn playwright test -c tests/coin/playwright.config.ts trench-vault.spec.ts`
  — **1/1 passed**.
- `git diff --check` — **passed** after the final lint cleanup.

The Node direct-import tests emitted only the existing `MODULE_TYPELESS_PACKAGE_JSON` performance
warning; no test failed. A broader lint probe also reaches the pre-existing
`@typescript-eslint/no-unsafe-finally` finding in `tests/maestro/fixtures/bitterlessApp.fixture.ts`;
the same construct exists in `HEAD` and is not introduced or modified by task 011. It is not hidden
inside the focused PASS claim above.

## Electron and visual evidence

The focused Electron run reported `BITTERLESS_E2E=1`, unpackaged mode, and mock Keychain enabled.
The only credential-path diagnostic was the injected isolated runtime password. The fixture also
proved active loopback Todo synchronization while denying all other network, no renderer errors,
three-module drill-in, exact small and greater-than-128-KiB documents, live selection-preserving
refresh, singleton/reopen behavior, and final native-window placement on `DELL S2721QS`.

Fresh screenshots were visually inspected at original resolution:

- `out/playwright/coin/screenshots/trench-vault-1360x860.png` — 2720×1720 physical pixels at 2× DPR.
- `out/playwright/coin/screenshots/trench-vault-800x600.png` — 1600×1200 physical pixels at 2× DPR.

Both retain clear list/detail hierarchy, bounded long identities and hashes, independent pane
scrolling, visible actions and status, and no shell/body clipping at the tested viewport.

## Final verdict

**PASS.** The frozen task 011 contract is satisfied with no remaining blocker or important finding.
The active Trench browser is read-only, race-safe for the covered revision interleavings, exact for
persisted JSON, isolated from Keychain access in E2E, and accepted in Electron on the requested DELL
display at both required window sizes.
