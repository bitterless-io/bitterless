# Review: trench-gmgn-settings-020

## Findings

- **P1 · blocking:** None open.
- **P2 · blocking:** None open.
- **P3 · non-blocking:** None.

## Resolved during Verify

- The first review found that exact `~/.yarn/bin/gmgn-cli` discovery still executed a Yarn v1
  `#!/usr/bin/env node` shim directly while retaining a desktop GUI PATH without Node, so the real
  documented installation failed with exit 127. Develop fixed that boundary in
  `src/main/coin/resources/gmgnCli.service.ts:167-226,566-651`. Native executables remain direct.
  App-Node delegation now applies only when the candidate is exact `~/.yarn/bin/gmgn-cli`, its
  realpath equals the declared bin of a fixed `gmgn-cli` package root, the package name is exact,
  and the real entry has the exact `#!/usr/bin/env node` first line. Unverified env-node scripts
  fail closed. The verified entry runs through the app executable with the one fixed
  `ELECTRON_RUN_AS_NODE=1` addition while the sanitized child PATH remains byte-for-byte unchanged.
- I independently verified the real machine chain:
  `~/.yarn/bin/gmgn-cli -> ~/.config/yarn/global/node_modules/.bin/gmgn-cli ->
  gmgn-cli/dist/index.js`; package name/bin and exact shebang all match. Directly invoking that real
  entry through the app Electron binary with `ELECTRON_RUN_AS_NODE=1` and
  `PATH=/usr/bin:/bin:/usr/sbin:/sbin` printed `1.5.2` and exited 0. The new real-runner unit and
  fresh Electron E2E independently cover the same boundary. The original P1 is resolved.

## Contract evidence

- `src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue:2-69` places the stable,
  keyboard-labelled GMGN gear immediately after Refresh. `TrenchHeader.less:1-22,35-84` retains the
  accepted 32px Royal Blue header, standalone/Omni drag and padding rules, and the shared 28px
  Todo-style icon treatment. The narrow breakpoint removes only the status label.
- `src/renderer/coin/src/App.vue:8-10` mounts one shared `TrenchGmgnSettings` instance. Its modal and
  store expose sanitized status, blank password replacement, Recheck, Verify existing, Get key,
  Save and verify, pending deduplication, typed feedback, and input clearing. The controller calls
  only the four resource methods and contains no INDEX client, storage, SQLite, or automatic retry.
- `src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue:51-63,164-197,
  288-347` exposes `Configure GMGN` only for `PROVIDER_UNAVAILABLE`. Opening the shared overlay does
  not mutate `caText`; closing it returns to the still-open Add modal, and only a second explicit
  Add click calls `store.addTarget`. Other INDEX errors render no settings action.
- `src/preload/trench/trench.preload.ts:18-34` exposes exactly `detectGmgn`, `saveGmgnApiKey`,
  `verifyGmgn`, and `openGmgnOfficialLink` beneath the frozen resource bridge. It does not expose the
  legacy Coin status, service, Codex, cancellation, filesystem, or INDEX surfaces.
- `src/main/coin/coinIpc.service.ts:48-76` idempotently registers only those four channels during
  foreground startup; no active Main call registers the dormant `registerCoinIpc` legacy surface.
  `src/main/coin/coinSender.guard.ts:43-71` requires a live main frame and an exact built or loopback
  Trench URL and rejects destroyed, remote, subframe, Home, and other local renderer identities.
- `src/main/coin/resources/gmgnCli.service.ts:461-498,556-564,705-746` validates and atomically
  replaces only `GMGN_API_KEY` with owner-only modes, reads back only configured/private-key
  booleans, and returns bounded typed probe receipts without stdout, stderr, environment, or key
  bytes. Renderer state clears the replacement after every attempted save; inspected screenshots
  contain no key value.
- The INDEX schema, hidden `trench-io` runtime, legacy JSON repository, and MCP schema are untouched
  by the settings component. The executable MCP contract and static schema audit still expose the
  exact 12 public `trench.*` tools.

## Verification evidence

- PASS — `node tests/coin/run-unit.mjs`: 141/141, including real `runCoinProcess` execution of a
  realistic Yarn v1 package under the minimal desktop PATH, unchanged child PATH, exact App-Node
  arguments/environment, unverified env-node rejection, and unchanged native execution.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: 12/12.
- PASS — `node --test scripts/mcp/trench-contract.test.mjs`: 1/1; exact 12-tool contract.
- PASS — `node --test tests/omni/trenchOmniEmbedding.test.mjs`: 6/6.
- PASS — `./node_modules/.bin/vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json`.
- PASS — `yarn typecheck:node`, `yarn typecheck:mcp`, and `yarn check:renderer-i18n`.
- PASS — fresh `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn build`;
  Main, the four-method Trench preload, Coin renderer, and hidden `trench-io` targets built under
  the DEBUG_DEV identity.
- PASS — isolated DEBUG_DEV
  `yarn test:e2e:coin tests/coin/specs/trench-index.spec.ts --project electron`: 1/1 in 34.2s. The
  whole fresh Electron process asserted exact `PATH=/usr/bin:/bin:/usr/sbin:/sbin`; its fixture used
  the real Yarn v1 symlink/package-declared env-node shape and recorded the actual `--version` call.
  It also repeated the shared modal entries, read-only probe, four-CA preservation, explicit retry,
  standalone/Omni geometries, and zero renderer/network error assertions.
- PASS — `git diff --check`.

## Existing Electron evidence and visual inspection

The independently repeated isolated DEBUG_DEV Electron result covers one shared modal from MenuBar
and Add recovery, blank non-readback input, fixture save/probe, unchanged four-CA text, explicit
retry, and zero document overflow at standalone 1360x860 and Omni 398x568 / 800x282. I inspected the
four result screenshots at original resolution. The MenuBar geometry is consistent; the
short-height modal scrolls internally; controls remain reachable; no API-key value is visible; and
the recovery result contains the four preserved BSC CAs plus the prior fixture target.

## Safety

All verification used read-only source inspection, temporary unit fixtures, the DEBUG_DEV build
profile, and a value-free process probe. `HOME`/`USERPROFILE`/XDG paths in Electron fixtures point to
an isolated `/tmp/bl-maestro-*` home, so the fixture key never reaches the real GMGN credential
file. No command stopped, restarted, wrote, or otherwise touched the running DEBUG_PROD application,
profile, database, MCP server, or Trench records.

## Conclusion

**pass** — no open P1/P2/P3 finding remains. The documented Yarn-global CLI now passes the real
minimal desktop-PATH process boundary without widening child PATH or delegating unknown scripts;
the UI, credential boundary, four-method preload/handler subset, explicit recovery, responsive
layout, and exact 12-tool compatibility also pass independent static, unit, build, and Electron
verification.
