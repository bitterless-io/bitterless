# Result: Trench GMGN Settings

## Outcome

Trench now exposes the existing Main-owned GMGN read boundary from a settings gear in its accepted
32px Todo-parity menu bar and from actionable INDEX provider failures. Standalone and Omni use one
shared modal to detect the CLI, show sanitized credential/probe state, save or replace only
`GMGN_API_KEY`, verify read-only access, and return to the preserved Add request for an explicit
retry.

## Delivered

- Added the Todo-style 28px settings action after Refresh without changing header geometry,
  standalone traffic-light padding, Omni drag behavior, or the narrow-width Agent/Refresh controls.
- Added one shared Trench GMGN modal and controller with Recheck, Verify existing key, Get API key,
  Save and verify, typed status/error feedback, pending deduplication, focus restoration, native
  password-input labelling, and internal scrolling for short Omni cells. Existing keys are never
  returned and replacement input is cleared after every attempt.
- Exposed exactly four existing Coin resource methods from the sandboxed Trench preload. Main
  registers only this idempotent GMGN handler subset during foreground startup; the dormant legacy
  Coin IPC surface remains inactive. A dedicated sender guard accepts only live built/loopback
  Trench main frames, including Omni, and rejects other renderers, remote content, and subframes.
- Extended deterministic executable discovery with exact `<home>/.yarn/bin`, path deduplication,
  and executable-file checks. Native executables stay direct. Only an exact Yarn env-node launcher
  whose real path equals the fixed global `gmgn-cli` package's declared bin is executed through the
  packaged Electron runtime with `ELECTRON_RUN_AS_NODE=1`; its sanitized desktop `PATH` is not
  expanded. No arbitrary script delegation, login shell, broad search, renderer-selected path,
  private key, or trading command was added.
- Added `Configure GMGN` only for `PROVIDER_UNAVAILABLE` in the Add dialog and workspace error.
  Opening settings preserves Add CA text, closing returns to Add, and recovery never automatically
  retries analysis.
- Kept INDEX schema/ranking, `trench-io`, the legacy JSON repository, credential location, and the
  exact 12 public `trench.*` MCP tools unchanged.

## Verification

- PASS — `./node_modules/.bin/vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json`.
- PASS — `yarn typecheck:node` and `yarn typecheck:mcp`.
- PASS — `node tests/coin/run-unit.mjs`: `141/141`, including a real process-runner regression for
  a realistic Yarn env-node package under `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, unverified-script
  and non-executable rejection, controller ordering/clearing/deduplication, sender rejection, and
  foreground registration of only the idempotent four-channel GMGN subset.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: `6/6` native SQLCipher integration tests.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: `12/12` UI, bridge, hidden-runtime,
  schema, and exact 12-tool invariants.
- PASS — `yarn check:renderer-i18n`.
- PASS — `node --test scripts/mcp/trench-contract.test.mjs`: `1/1`; tools/list retained the exact 12
  `trench.*` names and their read/write contract.
- PASS — `node --test scripts/mcp/trench-skill-export.test.mjs`: `1/1`; and
  `node --test tests/coin/trenchAgentGuide.test.mjs`: `6/6`.
- PASS — `node --test tests/omni/trenchOmniEmbedding.test.mjs`: `6/6`.
- PASS — isolated DEBUG_DEV
  `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn build`; Main, four-method
  Trench preload, Coin renderer, and hidden `trench-io` targets built.
- PASS — isolated DEBUG_DEV focused Electron E2E: `1/1` in 34.4s. It verified the live bridge and
  read-only probe while the whole desktop process had
  `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Its realistic Yarn v1 package fixture used the exact
  `~/.yarn/bin` -> global `.bin` -> declared env-node entry chain; the test asserted that packaged
  Electron Node mode actually invoked `--version`. It also covered standalone and Omni menu entry,
  398x568 and 800x282 internal scrolling with zero root overflow, provider-failure recovery, blank
  non-readback input, four-CA text preservation, save/verify, explicit retry, five resulting BSC
  targets, and no renderer/network errors.
- PASS — visual inspection of `out/playwright/coin/screenshots/trench-gmgn-settings-standalone-1360x860.png`,
  `trench-gmgn-settings-omni-398x568.png`, `trench-gmgn-settings-omni-800x282.png`, and
  `trench-gmgn-recovery-four-ca.png`. Controls remain readable/reachable, the short cell scrolls
  internally, and no API-key value appears.
- PASS — `git diff --check`.

The broad strict `./node_modules/.bin/tsc --noEmit -p tests/coin/tsconfig.trench-node.json` retains
four pre-existing errors outside task 020: one Codex credential `never.catch`, one meme-analysis
`unknown` metric, and two Coin resource `cancelled` union mismatches. This is the same unrelated
baseline documented by tasks 018–019; task-owned Main/preload code passed the DEBUG_DEV production
bundle, node build typecheck, focused units, and live Electron IPC acceptance.

No DEBUG_PROD command, process, profile, database, MCP server, or record was stopped, restarted, or
written. Builds and Electron acceptance used only the isolated DEBUG_DEV wrapper and temporary E2E
home/userData directories.

## Review

The first independent Verify found one P1 in the Yarn env-node execution boundary. The P1 is now
addressed by the constrained packaged-Electron Node-mode strategy and the real-runner/minimal-PATH
regressions above. Independent re-Verify is pending; task status remains `verify`.
