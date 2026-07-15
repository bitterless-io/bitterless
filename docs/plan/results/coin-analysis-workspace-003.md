# Coin Analysis Workspace Result

Task: `coin-analysis-workspace-003`

Status: Implemented; owner verification pending

## Delivered behavior

- Monitor uses the configured Binance feature-state HTTP endpoints and configured WebSocket. It
  preserves prior rows during refresh/failure and labels connection, row error, and stale states.
- Screener uses the configured parse/screen POST contracts. Live and sample are explicit modes;
  response-mode mismatch is rejected and there is no automatic sample fallback.
- Meme supports explicit `service` and `local` modes. Service mode is preferred when configured but
  never becomes an error fallback. Local mode combines fixed serial GMGN reads with read-only
  Alchemy identity/account checks and exposes unsupported metrics as `null + reason`.
- Discover is opt-in, cancellable polling. Local mode enforces a 60-second minimum, one trenches
  process per poll, and score deltas between observations. Close/logout/quit cleanup stops polling,
  requests, monitor sockets, and reconnect timers.
- Strategy v1 emits exactly `BUY`, `HOLD`, or `SELL`, cites evidence IDs, permits `HOLD` only with a
  complete valid position and risk input, and lets hard risk gates force `SELL`. It cannot trade.
- Drafts, watches, analyses, decisions, and source receipt history use strict versioned owner-only
  atomic JSON. Revision conflicts and malformed state are visible; recovery quarantines the bad
  file rather than silently loading empty state.
- Monitor, Screener, Meme, Strategy, History, Sources, and Resources are operational flat views
  with compact controls, request locking/cancellation, table-body scrolling, and distinct empty,
  unavailable, error, stale, and loading states. Coin still has no chat surface.

## Implementation inventory

Shared contracts and IPC:

- `src/shared/coin/coinAnalysis.type.ts`
- `src/shared/coin/coinBridge.type.ts`
- `src/main/coin/coinIpc.service.ts`
- `src/main/xpc/coinWindow.handler.ts`
- `src/preload/coin/coin.preload.ts`
- `src/main/coin/coinWindow.manager.ts`

Main-process data, state, strategy, and resource extensions:

- `src/main/coin/data/coinHttp.client.ts`
- `src/main/coin/data/coinData.validation.ts`
- `src/main/coin/data/coinData.normalize.ts`
- `src/main/coin/data/memeAnalysis.normalize.ts`
- `src/main/coin/data/discover.normalize.ts`
- `src/main/coin/data/coinData.service.ts`
- `src/main/coin/data/coinData.runtime.ts`
- `src/main/coin/state/coinState.schema.ts`
- `src/main/coin/state/coinState.service.ts`
- `src/main/coin/strategy/coinStrategy.service.ts`
- `src/main/coin/resources/gmgnCli.service.ts`
- `src/main/coin/resources/alchemyResource.service.ts`
- `src/main/coin/resources/coinResource.runtime.ts`

Renderer workspace:

- `src/renderer/coin/src/views/analysis/coinWorkspace.store.ts`
- `src/renderer/coin/src/views/analysis/CoinResultState.vue`
- `src/renderer/coin/src/views/analysis/MonitorView.vue`
- `src/renderer/coin/src/views/analysis/ScreenerView.vue`
- `src/renderer/coin/src/views/analysis/MemeView.vue`
- `src/renderer/coin/src/views/analysis/MemeDiscoverPanel.vue`
- `src/renderer/coin/src/views/analysis/MemeAnalysisPanel.vue`
- `src/renderer/coin/src/views/analysis/StrategyNumberField.vue`
- `src/renderer/coin/src/views/analysis/StrategyView.vue`
- `src/renderer/coin/src/views/analysis/HistoryView.vue`
- `src/renderer/coin/src/components/CoinAnalysisPane.vue`
- `src/renderer/coin/src/components/CoinEvidenceStrip.vue`
- `src/renderer/coin/src/components/CoinSourcesDrawer.vue`
- `src/renderer/coin/src/components/CoinStatusBar.vue`
- `src/renderer/coin/src/components/CoinWindowHeader.vue`
- `src/renderer/coin/src/App.vue`
- `src/renderer/coin/src/App.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`

Authored test/fixture sources, intentionally not executed:

- `tests/coin/fixtures/gmgn-local-analysis.json`
- `tests/coin/fixtures/gmgn-local-partial.json`
- `tests/coin/unit/coinStrategy.service.test.ts`
- `tests/coin/unit/coinState.service.test.ts`
- `tests/coin/unit/memeAnalysis.normalize.test.ts`
- `tests/coin/unit/coinData.normalize.test.ts`
- `tests/coin/unit/gmgnCli.service.test.ts`
- `tests/coin/unit/alchemyResource.service.test.ts`
- `tests/coin/tsconfig.unit.json`
- `tests/coin/specs/shell.spec.ts`

Updated task/feature/setup truth:

- `docs/plan/tasks/coin-analysis-workspace-003.md`
- `docs/plan/results/coin-analysis-workspace-003.md`
- `docs/plan/analysis/coin-subapp.md`
- `docs/features/coin.md`
- `docs/features/coin-layout.md`
- `docs/guides/coin-data-sources.md`
- `docs/guides/gmgn-cli.md`

## Security and truthfulness boundaries

Renderer requests contain only typed mode/chain/address/limits and structured strategy data. The
main process owns executable resolution, resource secrets, URL resolution, request caps, process
arguments, persistence paths, and sender validation. GMGN uses `shell: false`, fixed read-only
templates, a sanitized environment, a bounded queue, timeouts/output caps/cooldowns, and rejects
any detected `GMGN_PRIVATE_KEY`. Alchemy calls are read-only. No swap, order, signing, private-key,
wallet-control, arbitrary path/argument, or order-execution API exists.

Observed GMGN concepts are labelled observed and carry source evidence. Derived token fit is
labelled inferred. Cohort, EOA, wallet-PnL, and attention dimensions absent from a source remain
unavailable with a reason; they are not synthesized as zero.

## Verification status and risks

No E2E, Electron launch, build, typecheck, lint, unit test, git-diff check, screenshot, or other
verification command was run, exactly as requested by the owner. The authored assertions and
fixtures have not been executed.

The following remain unverified:

- deployed Monitor WebSocket payload shape, reconnect behavior, and exact Monitor HTTP response;
- deployed Screener parse/screen and optional Meme `/api/meme/discover` and `/api/meme/analyze`
  response shapes;
- `gmgn-cli` 1.5.2 argument/JSON compatibility, supported Robinhood commands, live quotas, and
  retry-after wording;
- Alchemy batch JSON-RPC acceptance and chain/account method support for each configured endpoint;
- Arco/Tabler component typings, renderer compilation, layout/overflow at `1360x860` and `800x600`;
- file permissions, atomic replacement, revision conflict, malformed recovery, cancellation, and
  lifecycle behavior in packaged macOS/Windows builds;
- live sources supplying enough holder labels/cohort/EOA/PnL data for every rich Meme metric. A
  valid partial result is expected to show unavailable reasons for unsupported dimensions.

## Owner exercise steps

1. Launch the normal Coin development/package flow, open Mini Apps → Coin, and confirm the window
   remains one full-width no-chat workspace on repeated Open.
2. Resources: configure Monitor/Screener service bases through the existing service configuration,
   optionally configure the preferred Meme service, install/configure/verify GMGN CLI, and save a
   read-only Alchemy HTTPS endpoint for the chain being exercised. Confirm only masked status is
   visible after reopening Resources.
3. Sources: open the header source control. Confirm each source independently reports configured,
   support, freshness/cooldown, and last reason without a secret or full endpoint.
4. Monitor: enter symbols such as `BTCUSDT, ETHUSDT`, choose Load to establish HTTP plus WebSocket,
   then Refresh. Confirm prior rows remain while refreshing and missing/stale/error rows are not
   converted to successful zero values.
5. Screener: enter a query, Parse, select Live, and Screen. Then explicitly select Sample and run it
   again. Confirm both results remain visibly labelled and a live failure never produces sample
   output.
6. Meme → Discover: select Service or Local deliberately, choose chain/stages/window/limit, and
   Start. Confirm candidate score deltas update after a later poll, the local next-poll time is at
   least 60 seconds away, and Stop cancels the session without clearing the latest snapshot.
7. Meme → Analyze: select mode, chain, CA, holder/trader limits, and Analyze. Inspect holder count,
   Top 10/100, GMGN rates, cohort overlaps/shares, EOA-only metrics/cohorts, key wallets,
   concepts/fits, risks, warnings, unavailable fields, and receipts. In Local mode, confirm the UI
   says Local CLI/RPC and never silently changes mode. Exercise Cancel during a request.
8. Strategy: evaluate complete structured evidence without a position and confirm only BUY/SELL is
   possible. Add entry price, remaining amount, invested amount, and risk input to make HOLD
   eligible. Trigger a hard risk gate and confirm SELL plus evidence-linked reasons. Confirm no
   order/signing action is present.
9. History: filter and reopen an analysis/decision. Confirm the stored result restores without a
   network/CLI request. Change a draft, reopen Coin, and confirm drafts/watchlist/history survive.
10. Lifecycle/recovery: start Discover or another cancellable request, close Coin or log out, and
    confirm no polling/process/socket survives. If a malformed-state banner appears, use its
    recovery action and confirm the invalid file is quarantined rather than silently ignored.

Do not call the task verified until the owner has completed the relevant live-source, packaged-file,
and visual checks above.
