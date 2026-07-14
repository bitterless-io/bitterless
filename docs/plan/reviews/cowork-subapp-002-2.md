# Review: cowork-subapp-002 (round 2)

## Findings

None. The sole P2 finding from round 1 is resolved.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Production focus behavior | pass | Reusing an existing Cowork instance still enters `coworkWindowHelper.show()` (`src/main/xpc/coworkWindow.handler.ts:63-66`). `WindowHelper.show()` restores a minimized window, shows it, activates and raises the app on macOS with `app.focus({ steal: true })` plus `moveTop()`, and finally calls `win.focus()` on every platform (`src/cowork/main/windows/window.helper.ts:129-139`). This strengthens the real runtime path without an E2E/environment branch. |
| Exact existing-window focus proof | pass | After bringing Bitterless Home forward, the E2E resolves the first Cowork BrowserWindow by its captured ID, wraps that exact instance's `focus()` method, records calls, and delegates to the bound original method (`tests/cowork/specs/baseline.spec.ts:124-140`). Repeated Open still happens by clicking the real Cowork Mini Apps button, after which the test requires at least one focus call for that original ID (`baseline.spec.ts:141-160`). The wrapper is an observation probe, not a stub: production focus behavior still executes. |
| Native-focus layer | pass | The fixture records whether the launch exposes any native focused BrowserWindow before repeated Open. When native focus is observable, it additionally polls the same Cowork ID until `isFocused()` is true (`baseline.spec.ts:129-140,161-169`). When macOS launches Playwright entirely in the background and Electron reports no focused window at all, the unconditional exact-method probe still verifies the application requested focus through the production path. This conditional native assertion does not weaken normal foreground coverage. |
| Singleton and visibility | pass | The focus probe is additive to the existing assertion: repeated Open must retain one Cowork BrowserWindow with the same ID and visible state (`baseline.spec.ts:142-154`). The later close/reopen checks still require complete Cowork-session webContents cleanup and a new graph. |
| No production test hook/backdoor | pass | The focus-call array and method wrapper exist only inside Playwright's main-process `app.evaluate` callback. Production source contains no `BITTERLESS_E2E` focus exception, global probe, or alternate focus implementation. The packaged-E2E rejection, exact session network guards, and key-storage boundaries reviewed in round 1 are unchanged. |
| Static parity guard | pass | `check-embedded-host.mjs` now guards the production `show → macOS app activation/raise → window focus` sequence (`scripts/cowork/check-embedded-host.mjs:25-48`). Independently running `yarn check:cowork` executed all 36 parity checks and exited 0. |
| Built Electron E2E | pass | The built main bundle contains the new activation/raise/focus sequence. `yarn test:e2e:cowork` was run independently twice; both runs passed 1/1 test, including the exact focus-call probe, singleton graph, four renderers plus operation page, cleanup, Todo, reopen/bootstrap, fail-closed networking, and zero renderer errors. |
| Targeted E2E TypeScript | pass | Direct `tsc --noEmit` over the Playwright config, fixture, ARIA helper, and baseline spec completed with 0 diagnostics. |
| Patch hygiene | pass | `git diff --check` exited 0. |

The native-focus condition is appropriate for the observed test-host boundary: an Electron process
launched in the background on macOS can report no focused BrowserWindow, so an unconditional
`isFocused()` assertion would test the external window manager's launch state rather than the
repeated-Open contract. The two layers together prove the controllable contract in every run and the
native result whenever the environment exposes it.

The repository-wide Node/web typecheck baselines and the live/signed-package manual gates remain as
documented in round 1; this focused review does not claim those external gates were rerun.

## Conclusion

**pass** — repeated Mini Apps Open now has executable evidence that the exact existing Cowork
BrowserWindow receives the real production focus call, while foreground-capable runs also require
native focus. Singleton/visibility coverage remains intact, no production test bypass was added,
and all requested round-2 checks passed.
