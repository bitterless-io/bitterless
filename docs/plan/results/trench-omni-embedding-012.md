# Trench Omni Embedding Verification

Task: `trench-omni-embedding-012`

Status: **PASS**

Date: 2026-08-09

This was an independent Verify pass against the frozen task and the current
`docs/features/omni-miniapp-cells.md`, `docs/features/coin.md`, and
`docs/features/coin-layout.md` contracts. Develop had stopped before this pass. No source, test, or
configuration file was changed during Verify; only this result, the task status, and the delivery
plan status were updated after every required gate passed.

## Findings

- **Blocker:** none.
- **Important:** none.
- **Platform evidence:** the real Electron acceptance ran on macOS. The Windows branches remain
  statically covered by the shared Electron implementation and fixture, but this result does not
  claim a Windows runtime run.
- **Existing structural debt:** `src/main/windows/omniWindow.helper.ts` is 1,266 lines, above the
  `TS-1` 800-line review limit. `HEAD` already contains 1,274 lines, and task 012 reduced that file by
  eight lines; this is not a task 012 regression.

## Frozen contract mapping

| Requirement | Result | Independent evidence |
|---|---|---|
| Fifth bounded mini app | PASS | `src/shared/omni/omni.types.ts:12-19,45-59` adds `trench`, its display URL, and bounded parsing. `tests/omni/trenchOmniEmbedding.test.mjs:16-43` proves the exact five-item allowlist, round trip, and rejection of `onlypreview`. |
| Browser URL and mini-app persistence | PASS | `src/shared/omni/omni.types.ts:196-209,237-255` and `src/renderer/omni/omniControl/src/store/layout.store.ts:41-44,86-119` preserve and parse complete leaf state. Real Electron switches Trench to the preserved browser URL, destroys the old view, switches back, and selects the newest first row at `tests/coin/specs/trench-omni.spec.ts:462-503`. |
| Control, icon, and i18n | PASS | `src/renderer/omni/omniControl/src/components/OmniPane.vue:35-65` exposes exactly five choices and uses `coin.png`; English and Chinese labels are present at `src/renderer/common/i18n/en.ts:285-288` and `zh.ts:286-289`. Static guards cover all mappings. |
| Dedicated secure runtime | PASS | `src/main/windows/omniMiniAppRuntime.service.ts:3-18` maps Trench to `trench.js`, the Coin renderer, and the only `sandbox: true` mini-app runtime. `src/main/windows/omniWindow.helper.ts:649-692` creates a local `WebContentsView` with context isolation, web security, no Node integration, no webview, no insecure content, and `--mode=omni`. `src/preload/trench/trench.preload.ts:1-16` exposes only static host context plus the sandbox-compatible XPC preload. |
| Native embedded identity and no standalone dependency | PASS | `tests/coin/specs/trench-omni.spec.ts:121-175,340-417` enumerates the native Omni `BaseWindow` children, observes the real Trench renderer, proves `host: omni`, no renderer `require` or `process`, and zero standalone Trench `BrowserWindow` before one is explicitly requested later. |
| Popup and navigation fence | PASS | `src/main/windows/omniWindow.helper.ts:854-870` denies new windows and prevents navigation/redirect away from the expected local renderer. Electron drives real HTTPS popup and navigation attempts at `tests/coin/specs/trench-omni.spec.ts:294-338,418-426`; the original URL and WebContents count remain unchanged while the stubbed `shell.openExternal` receives both URLs. |
| Multiple cells and standalone live refresh | PASS | Each renderer subscribes before loading and refreshes from the shared content-free repository broadcast. Electron proves two embedded cells receive record B, then two embedded cells plus standalone receive C, and after one cell is destroyed the remaining embedded and standalone views receive D at `tests/coin/specs/trench-omni.spec.ts:431-460,536-568`. |
| Cell teardown isolation | PASS | `src/main/windows/omniWindow.helper.ts:519-560,1065-1068` disposes only the changed or removed cell views. Electron confirms the removed secondary WebContents is destroyed while the primary, standalone, and repository stay live. |
| Three responsive sizes | PASS | `tests/coin/specs/trench-omni.spec.ts:262-292` requires root and viewport equality, document X/Y overflow at most one pixel, and a visible module control. The same run exercises and captures 800×568, 398×568 with Back navigation, and 800×282 through CA → Index → source → Back. |
| Fresh production assets | PASS | A new `yarn build` generated `out/main/app.main.js`, `out/preload/trench.js`, `out/renderer/coin/index.html`, and Omni Control after the newest listed source. The post-build test verifies existence, freshness, CSP-first/charset-second ordering, exact inline-script hashes, and Monaco workers. Direct inspection found charset at byte 371, one authorized inline script, and five existing worker targets. |
| Detail-source race safety | PASS | `src/renderer/coin/src/views/vault/trenchVault.store.ts:159-209,397-400,456-510` invalidates an old source generation whenever selection/search/detail context changes. The maintained deferred regression at `tests/coin/unit/trenchVault.store.test.ts:503-571` covers direct and refresh-time selection changes. |
| Target display and credential isolation | PASS | The run explicitly set `BITTERLESS_E2E_DISPLAY_LABEL='DELL S2721QS'`. The fixture checks target availability and every visible top-level window at its initial and final boundaries; the spec independently matches the Omni native bounds through `screen.getDisplayMatching`. macOS launch used `--use-mock-keychain`, isolated HOME/userData, and the run observed no `safeStorage` tripwire, unexpected or denied network request, or renderer error. |

## Commands and results

Passed independently:

- `node tests/coin/run-trench-unit.mjs` — **16/16 passed**.
- `node --test tests/omni/trenchOmniEmbedding.test.mjs tests/motto/mottoIntegration.test.mjs`
  — **10/10 passed**.
- `yarn test:motto` — **18/18 passed**.
- `yarn test:omni-layout` — **10/10 passed**.
- `yarn tsc -p tests/coin/tsconfig.trench-node.json` — **passed**.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false` —
  **passed**.
- `yarn tsc -p tests/e2e/tsconfig.strict.json` — **passed**.
- `yarn typecheck:node` — **passed** with the repository's standard `--noCheck` Node mode.
- `yarn check:renderer-i18n` — **passed**.
- Focused ESLint over the task Main/preload/shared/renderer/tests — **exit 0, zero errors**.
  The broad focused set reports 719 existing Prettier-format warnings; no source was reformatted during
  independent Verify.
- Focused tracked and untracked task 012 `git diff --check` — **passed**. The whole shared dirty tree
  separately reports an unrelated trailing blank line in
  `docs/plan/reviews/onlypreview-agent-skill-guide-009-1.md`; it is outside task 012 ownership.
- `yarn build` — **passed**.
- Post-build `node --test tests/omni/trenchOmniEmbedding.test.mjs` — **6/6 passed**, including the
  production freshness and CSP/worker audit.
- `BITTERLESS_E2E_DISPLAY_LABEL='DELL S2721QS' yarn playwright test -c tests/coin/playwright.config.ts trench-omni.spec.ts --workers=1`
  — **1/1 passed**.

An additional exploratory `noCheck: false` program over the entire legacy Omni helper reaches four
`HEAD`-identical diagnostics at its existing throttle options and generic Setting emitter calls. The
task-scoped strict configurations, repository-standard Node check, production build, and Electron run
all pass; the probe therefore records baseline type debt rather than a task 012 regression.

## Electron and visual evidence

The independent Electron run completed in 4.2 seconds. Its fixture used an isolated temporary HOME,
userData, local MCP bridge, and loopback mock origin, and cleaned up the Electron process afterward.
The resulting Playwright status is `passed` with no failed test IDs.

Fresh screenshots were inspected at original resolution:

- `out/playwright/coin/screenshots/trench-omni-800x568.png` — 1600×1136 physical pixels at 2× DPR;
  full list/detail hierarchy, visible Refresh/Copy, and independent JSON scrolling.
- `out/playwright/coin/screenshots/trench-omni-398x568.png` — 796×1136 physical pixels at 2× DPR;
  mutually exclusive mobile detail, visible Back/modules/Copy, and horizontal scrolling confined to
  the JSON viewer rather than the document body.
- `out/playwright/coin/screenshots/trench-omni-800x282.png` — 1600×564 physical pixels at 2× DPR;
  Index list/detail, source action, header/modules, and internal vertical scrolling remain reachable.

## Final verdict

**PASS.** Task 012 satisfies the frozen Trench-in-Omni product, lifecycle, responsive, security,
fresh-build, and macOS Electron acceptance contract. No blocker or important finding remains.
