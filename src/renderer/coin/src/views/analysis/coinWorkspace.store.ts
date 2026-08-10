import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  createDefaultCoinPersistentData,
  type CoinAiAnalysisReceipt,
  type CoinAiAnalysisTarget,
  type CoinAiRunErrorCode,
  type CoinAiTargetKind,
  type CoinChain,
  type CoinDataEnvelope,
  type CoinDataSourceStatus,
  type CoinDiscoverCandidate,
  type CoinDecisionResult,
  type CoinDiscoverSnapshot,
  type CoinHistoryEntry,
  type CoinHistoryType,
  type CoinMemeAnalysisResult,
  type CoinMemeSourceMode,
  type CoinMonitorEvent,
  type CoinMonitorResult,
  type CoinPersistentData,
  type CoinScreenerParseResult,
  type CoinScreenerResult,
  type CoinSourceReceipt,
  type CoinStoredAnalysis,
  type CoinStrategyInput,
  type CoinWatchItem,
  type CoinXBrowserDisplayMode,
} from '@shared/coin/coinAnalysis.type';
import {
  coinAddressesEqual,
  coinCandidateChains,
  extractCoinAddressCandidates,
  extractSingleCoinAddress,
} from '@shared/coin/coinAddress';
import { coinShellStore } from '../../coinShell.store';
import { coinXBrowserStore } from './coinXBrowser.store';

const MAX_ANALYSES = 500;
const MAX_DECISIONS = 500;
const MAX_HISTORY = 2_000;
const MAX_RECEIPTS = 2_000;
const SAVE_DELAY_MS = 300;
const MAX_PERSISTED_BYTES = 3_500_000;
let initializePromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let monitorUnsubscribe: (() => void) | null = null;
let discoverUnsubscribe: (() => void) | null = null;

const requestId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

const normalizedContractAddress = (value: string): string =>
  value.trim().replace(/^[`'"\s]+|[`'"\s]+$/g, '');

const addressMatchesChain = (
  value: string,
  chain: CoinPersistentData['drafts']['meme']['chain'],
): boolean => coinCandidateChains(value).includes(chain);

const contractAddressMatches = (
  chain: CoinWatchItem['chain'],
  left: string,
  right: string,
): boolean => Boolean(chain && coinAddressesEqual(chain, left, right));

export const parseMonitorSymbols = (value: string): string[] => {
  const symbols: string[] = [];
  const seen = new Set<string>();
  for (const token of value.split(/[,\s]+/)) {
    let symbol = token.trim().toUpperCase().replace(/[-_/:]/g, '');
    if (!symbol || !/^[A-Z0-9]+$/.test(symbol)) continue;
    if (!symbol.endsWith('USDT') && !symbol.endsWith('USDC')) symbol = `${symbol}USDT`;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols.slice(0, 50);
};

const parseSymbolList = (value: string): string[] =>
  [...new Set(value.split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter((item) => /^[A-Z0-9]{2,24}$/.test(item)))].slice(0, 100);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const finite = (value: number | null, label: string, options: { positive?: boolean; max?: number } = {}): number => {
  if (value === null || !Number.isFinite(value) || (options.positive ? value <= 0 : value < 0) || (options.max !== undefined && value > options.max)) {
    throw new Error(label);
  }
  return value;
};

class CoinWorkspaceState {
  data: CoinPersistentData = createDefaultCoinPersistentData();
  revision = 0;
  initialized = false;
  stateLoading = false;
  stateMalformed = false;
  stateConflict = false;
  stateSaving = false;
  stateRecovering = false;
  stateError = '';
  clipboardLoading = false;
  commandError = '';
  sourceStatuses: CoinDataSourceStatus[] = [];
  sourceLoading = false;
  sourceError = '';

  monitorResult: CoinMonitorResult | null = null;
  monitorLoading = false;
  monitorRefreshing = false;
  monitorError = '';
  monitorRequestId: string | null = null;

  screenerParseResult: CoinScreenerParseResult | null = null;
  screenerResult: CoinScreenerResult | null = null;
  screenerParsing = false;
  screenerLoading = false;
  screenerError = '';
  screenerParseRequestId: string | null = null;
  screenerRequestId: string | null = null;

  memeAnalysis: CoinMemeAnalysisResult | null = null;
  memeLoading = false;
  memeError = '';
  memeRequestId: string | null = null;
  memeDetectedChains: CoinChain[] = [];
  memeDetectingChains: CoinChain[] = [];
  discoverStarting = false;
  discoverStopping = false;
  discoverSnapshot: CoinDiscoverSnapshot | null = null;
  discoverError = '';

  strategyResult: CoinDecisionResult | null = null;
  strategyReceipt: CoinSourceReceipt | null = null;
  strategyLoading = false;
  strategyError = '';

  aiLoading = false;
  aiCancelling = false;
  aiError = '';
  aiRunId: string | null = null;
  aiTarget: CoinAiAnalysisTarget | null = null;
  decisionError = '';

  private persistAfterAi = false;

  get activeReceipts(): CoinSourceReceipt[] {
    return this.memeAnalysis?.receipts ?? this.discoverSnapshot?.receipts ?? [];
  }

  get focusItems(): CoinWatchItem[] {
    return [...this.data.watchlist]
      .filter((item) => item.kind === 'token')
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  get currentTokenFocused(): boolean {
    return this.isFocused(
      this.data.drafts.meme.chain,
      this.data.drafts.meme.contractAddress,
    );
  }

  get activeJobCount(): number {
    return [
      this.monitorLoading || this.monitorRefreshing,
      this.screenerParsing,
      this.screenerLoading,
      this.memeLoading,
      this.discoverStarting || Boolean(this.discoverSnapshot?.running),
      this.strategyLoading,
      this.aiLoading,
    ].filter(Boolean).length;
  }

  initialize(): Promise<void> {
    if (initializePromise) return initializePromise;
    initializePromise = this.performInitialize();
    return initializePromise;
  }

  async refreshSources(): Promise<void> {
    if (this.sourceLoading) return;
    this.sourceLoading = true;
    this.sourceError = '';
    try {
      this.sourceStatuses = await window.coin.data.getSources();
    } catch (error) {
      console.error('[Coin] Data source status failed:', error);
      this.sourceError = i18nHelper.coin.analysis.errors.sources;
    } finally {
      this.sourceLoading = false;
    }
  }

  setActivePage(page: CoinPersistentData['activePage']): void {
    this.data.activePage = page;
    if (page === 'resources') coinShellStore.openResources();
    else if (page === 'history') coinShellStore.openHistory();
    else coinShellStore.closeSecondary();
    this.queuePersist();
  }

  closeSecondary(): void {
    this.data.activePage = 'meme';
    coinShellStore.closeSecondary();
    this.queuePersist();
  }

  async setXBrowserDisplayMode(displayMode: CoinXBrowserDisplayMode): Promise<void> {
    if (coinXBrowserStore.status.mode === 'cdp') return;
    this.data.xBrowser.displayMode = displayMode;
    this.queuePersist();
    await coinXBrowserStore.setDisplayMode(displayMode);
  }

  async pasteAndAnalyze(): Promise<void> {
    if (this.clipboardLoading || this.memeLoading) return;
    this.clipboardLoading = true;
    this.commandError = '';
    try {
      const clipboardText = await window.coin.clipboard.readText();
      if (!clipboardText.trim()) {
        this.commandError = i18nHelper.coin.trench.errors.clipboardEmpty;
        return;
      }
      const candidates = extractCoinAddressCandidates(clipboardText);
      if (candidates.length === 0) {
        this.commandError = i18nHelper.coin.trench.errors.addressInvalid;
        return;
      }
      if (candidates.length > 1) {
        this.commandError = i18nHelper.coin.trench.errors.addressMultiple;
        return;
      }
      this.data.drafts.meme.contractAddress = candidates[0];
      this.data.drafts.meme.view = 'analyze';
      this.closeSecondary();
      await this.autoAnalyzeMeme();
    } catch (error) {
      console.error('[Coin] Clipboard read failed:', error);
      this.commandError = i18nHelper.coin.trench.errors.clipboardRead;
    } finally {
      this.clipboardLoading = false;
    }
  }

  async analyzeFromCommand(): Promise<void> {
    this.commandError = '';
    const candidates = extractCoinAddressCandidates(this.data.drafts.meme.contractAddress);
    const address = extractSingleCoinAddress(this.data.drafts.meme.contractAddress);
    if (!address) {
      this.commandError = candidates.length > 1
        ? i18nHelper.coin.trench.errors.addressMultiple
        : i18nHelper.coin.trench.errors.addressInvalid;
      return;
    }
    this.data.drafts.meme.contractAddress = address;
    this.data.drafts.meme.view = 'analyze';
    this.closeSecondary();
    await this.autoAnalyzeMeme();
  }

  selectCandidate(candidate: CoinDiscoverCandidate): void {
    this.selectToken(candidate.chain, candidate.contractAddress);
  }

  async analyzeCandidate(candidate: CoinDiscoverCandidate): Promise<void> {
    this.selectCandidate(candidate);
    await this.analyzeMeme('service');
  }

  selectFocus(item: CoinWatchItem): void {
    if (item.kind !== 'token' || !item.chain) return;
    this.selectToken(item.chain, item.asset);
  }

  addCandidateToFocus(candidate: CoinDiscoverCandidate): void {
    this.addFocusToken(candidate.contractAddress, candidate.chain);
  }

  addCurrentToFocus(): void {
    const address = normalizedContractAddress(this.data.drafts.meme.contractAddress);
    if (!address || !addressMatchesChain(address, this.data.drafts.meme.chain)) {
      this.commandError = i18nHelper.coin.trench.errors.addressChainMismatch;
      return;
    }
    this.addFocusToken(address, this.data.drafts.meme.chain);
  }

  removeFocus(id: string): void {
    this.data.watchlist = this.data.watchlist.filter((item) => item.id !== id);
    this.queuePersist();
  }

  isFocused(
    chain: CoinWatchItem['chain'],
    address: string,
  ): boolean {
    if (!chain || !address) return false;
    return this.data.watchlist.some((item) =>
      item.kind === 'token' &&
      item.chain === chain &&
      contractAddressMatches(chain, item.asset, address));
  }

  isCurrentToken(chain: CoinWatchItem['chain'], address: string): boolean {
    return Boolean(
      chain &&
      chain === this.data.drafts.meme.chain &&
      contractAddressMatches(chain, address, this.data.drafts.meme.contractAddress),
    );
  }

  tokensMatch(
    leftChain: CoinWatchItem['chain'],
    leftAddress: string,
    rightChain: CoinWatchItem['chain'],
    rightAddress: string,
  ): boolean {
    return Boolean(
      leftChain &&
      leftChain === rightChain &&
      contractAddressMatches(leftChain, leftAddress, rightAddress),
    );
  }

  async reviewCurrentThesis(): Promise<void> {
    const result = this.memeAnalysis;
    const thesis = this.data.drafts.decision.thesis.trim();
    this.decisionError = '';
    if (!result) {
      this.decisionError = i18nHelper.coin.trench.errors.analysisRequired;
      return;
    }
    if (!thesis) {
      this.decisionError = i18nHelper.coin.trench.errors.thesisRequired;
      return;
    }
    await this.analyzeWithAi('meme', result.id, thesis);
  }

  queuePersist(): void {
    if (!this.initialized || this.stateMalformed || this.stateConflict) return;
    if (this.aiLoading) {
      this.persistAfterAi = true;
      return;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void this.persist();
    }, SAVE_DELAY_MS);
  }

  async recoverState(): Promise<void> {
    if (this.stateRecovering) return;
    this.stateRecovering = true;
    this.stateError = '';
    try {
      const result = await window.coin.state.recover();
      if (result.status !== 'recovered' || !result.snapshot) {
        this.stateError = i18nHelper.coin.analysis.errors.stateRecovery;
        return;
      }
      this.revision = result.snapshot.revision;
      this.data = clone(result.snapshot.data);
      this.stateMalformed = false;
      this.stateConflict = false;
      this.restoreLatestResults();
      this.setShellPage(this.data.activePage);
      Message.success(i18nHelper.coin.analysis.state.recovered);
    } catch (error) {
      console.error('[Coin] State recovery failed:', error);
      this.stateError = i18nHelper.coin.analysis.errors.stateRecovery;
    } finally {
      this.stateRecovering = false;
    }
  }

  async reloadState(): Promise<void> {
    if (this.stateLoading) return;
    this.stateLoading = true;
    try {
      const result = await window.coin.state.load();
      if (result.status === 'malformed') {
        this.stateMalformed = true;
        this.stateConflict = false;
        this.stateError = i18nHelper.coin.analysis.state.malformed;
        return;
      }
      this.revision = result.snapshot.revision;
      this.data = clone(result.snapshot.data);
      this.stateMalformed = false;
      this.stateConflict = false;
      this.stateError = '';
      this.restoreLatestResults();
      this.setShellPage(this.data.activePage);
      Message.success(i18nHelper.coin.analysis.state.reloaded);
    } catch (error) {
      console.error('[Coin] State reload failed:', error);
      this.stateError = i18nHelper.coin.analysis.errors.stateLoad;
    } finally {
      this.stateLoading = false;
    }
  }

  async loadMonitor(refresh = false): Promise<void> {
    if (this.monitorLoading || this.monitorRefreshing) return;
    const symbols = parseMonitorSymbols(this.data.drafts.monitor.symbolsText);
    if (symbols.length === 0) {
      this.monitorError = i18nHelper.coin.analysis.errors.symbolsRequired;
      return;
    }
    const id = requestId(refresh ? 'monitor-refresh' : 'monitor-load');
    this.monitorRequestId = id;
    this.monitorError = '';
    if (refresh) this.monitorRefreshing = true;
    else this.monitorLoading = true;
    try {
      const envelope = refresh
        ? await window.coin.data.refreshMonitor({ requestId: id, symbols, connectLive: true })
        : await window.coin.data.monitor({ requestId: id, symbols, connectLive: true });
      this.consumeEnvelopeError(envelope, (message) => { this.monitorError = message; });
      if (envelope.data) {
        this.monitorResult = envelope.data;
        this.recordAnalysis('monitor', symbols.join(', '), null, envelope.data, envelope.data.receipts);
        this.addWatchSymbols(symbols);
      } else {
        this.appendReceipts([envelope.receipt]);
      }
      await this.refreshSources();
    } catch (error) {
      console.error('[Coin] Monitor request failed:', error);
      this.monitorError = i18nHelper.coin.analysis.errors.monitor;
    } finally {
      this.monitorLoading = false;
      this.monitorRefreshing = false;
      this.monitorRequestId = null;
    }
  }

  async cancelMonitor(): Promise<void> {
    if (!this.monitorRequestId) return;
    await window.coin.data.cancel({ requestId: this.monitorRequestId });
  }

  async parseScreener(): Promise<void> {
    if (this.screenerParsing) return;
    const query = this.data.drafts.screener.query.trim();
    if (!query) {
      this.screenerError = i18nHelper.coin.analysis.errors.queryRequired;
      return;
    }
    const id = requestId('screener-parse');
    this.screenerParseRequestId = id;
    this.screenerParsing = true;
    this.screenerError = '';
    try {
      const envelope = await window.coin.data.parseScreener({ requestId: id, query });
      this.consumeEnvelopeError(envelope, (message) => { this.screenerError = message; });
      if (envelope.data) this.screenerParseResult = envelope.data;
      this.appendReceipts([envelope.receipt]);
    } catch (error) {
      console.error('[Coin] Screener parse failed:', error);
      this.screenerError = i18nHelper.coin.analysis.errors.screener;
    } finally {
      this.screenerParsing = false;
      this.screenerParseRequestId = null;
    }
  }

  async cancelScreenerParse(): Promise<void> {
    if (!this.screenerParseRequestId) return;
    await window.coin.data.cancel({ requestId: this.screenerParseRequestId });
  }

  async screen(): Promise<void> {
    if (this.screenerLoading) return;
    const id = requestId('screener');
    this.screenerRequestId = id;
    this.screenerLoading = true;
    this.screenerError = '';
    try {
      const envelope = await window.coin.data.screen({
        requestId: id,
        query: this.data.drafts.screener.query.trim(),
        mode: this.data.drafts.screener.mode,
        symbols: parseSymbolList(this.data.drafts.screener.symbolsText),
        maxSymbols: 200,
        limit: 50,
        filters: this.screenerParseResult?.parsed.filters ?? [],
      });
      this.consumeEnvelopeError(envelope, (message) => { this.screenerError = message; });
      if (envelope.data) {
        this.screenerResult = envelope.data;
        this.recordAnalysis('screener', this.data.drafts.screener.query || envelope.data.mode, null, envelope.data, envelope.data.receipts);
      } else {
        this.appendReceipts([envelope.receipt]);
      }
      await this.refreshSources();
    } catch (error) {
      console.error('[Coin] Screener request failed:', error);
      this.screenerError = i18nHelper.coin.analysis.errors.screener;
    } finally {
      this.screenerLoading = false;
      this.screenerRequestId = null;
    }
  }

  async cancelScreener(): Promise<void> {
    if (!this.screenerRequestId) return;
    await window.coin.data.cancel({ requestId: this.screenerRequestId });
  }

  async autoAnalyzeMeme(): Promise<void> {
    if (this.memeLoading) return;
    const contractAddress = extractSingleCoinAddress(this.data.drafts.meme.contractAddress);
    if (!contractAddress) {
      this.commandError = i18nHelper.coin.trench.errors.addressInvalid;
      return;
    }
    const id = requestId('meme-auto');
    this.memeRequestId = id;
    this.memeLoading = true;
    this.memeError = '';
    this.commandError = '';
    this.memeDetectedChains = [];
    this.memeDetectingChains = coinCandidateChains(contractAddress);
    try {
      const envelope = await window.coin.data.autoAnalyzeMeme({
        requestId: id,
        contractAddress,
        holderLimit: 100,
        traderLimit: 100,
      });
      const failure = envelope.error?.message ?? '';
      this.commandError = failure;
      this.memeError = failure;
      if (envelope.data) {
        this.appendReceipts([...envelope.data.receipts, envelope.receipt]);
        if (envelope.data.matches.length === 0) {
          this.commandError = i18nHelper.coin.trench.errors.addressNotFound;
          this.memeError = this.commandError;
        } else {
          this.memeDetectedChains = envelope.data.matches.map(({ chain }) => chain);
          const active = envelope.data.matches.find(({ chain }) =>
            chain === envelope.data?.activeChain) ?? envelope.data.matches[0];
          this.data.drafts.meme.mode = 'local_cli_rpc';
          this.data.drafts.meme.chain = active.chain;
          this.data.drafts.meme.contractAddress = envelope.data.contractAddress;
          for (const match of [...envelope.data.matches].reverse()) {
            this.recordAnalysis(
              'meme',
              envelope.data.contractAddress,
              match.chain,
              match.analysis,
              match.analysis.receipts,
            );
          }
          this.replaceMemeAnalysis(active.analysis);
          this.applyAnalysisToStrategy(active.analysis);
        }
      } else {
        this.appendReceipts([envelope.receipt]);
      }
      await this.refreshSources();
    } catch (error) {
      console.error('[Coin] Automatic meme analysis failed:', error);
      this.commandError = i18nHelper.coin.analysis.errors.meme;
      this.memeError = this.commandError;
    } finally {
      this.memeLoading = false;
      this.memeRequestId = null;
      this.memeDetectingChains = [];
    }
  }

  async analyzeMeme(mode: CoinMemeSourceMode = this.data.drafts.meme.mode): Promise<void> {
    if (this.memeLoading) return;
    const contractAddress = this.data.drafts.meme.contractAddress.trim();
    if (!contractAddress) {
      this.memeError = i18nHelper.coin.analysis.errors.contractRequired;
      return;
    }
    const id = requestId('meme');
    this.memeRequestId = id;
    this.memeLoading = true;
    this.memeError = '';
    try {
      const envelope = await window.coin.data.analyzeMeme({
        requestId: id,
        mode,
        chain: this.data.drafts.meme.chain,
        contractAddress,
        holderLimit: 100,
        traderLimit: 100,
      });
      this.consumeEnvelopeError(envelope, (message) => { this.memeError = message; });
      if (envelope.data) {
        this.replaceMemeAnalysis(envelope.data);
        this.recordAnalysis('meme', contractAddress, this.data.drafts.meme.chain, envelope.data, envelope.data.receipts);
        this.applyAnalysisToStrategy(envelope.data);
      } else {
        this.appendReceipts([envelope.receipt]);
      }
      await this.refreshSources();
    } catch (error) {
      console.error('[Coin] Meme analysis failed:', error);
      this.memeError = i18nHelper.coin.analysis.errors.meme;
    } finally {
      this.memeLoading = false;
      this.memeRequestId = null;
    }
  }

  async cancelMeme(): Promise<void> {
    if (!this.memeRequestId) return;
    await window.coin.data.cancel({ requestId: this.memeRequestId });
  }

  async startDiscover(mode: CoinMemeSourceMode = this.data.drafts.meme.mode): Promise<void> {
    if (this.discoverStarting || this.discoverSnapshot?.running) return;
    this.discoverStarting = true;
    this.discoverError = '';
    try {
      const receipt = await window.coin.data.startDiscover({
        mode,
        chain: this.data.drafts.meme.chain,
        stages: this.data.drafts.meme.stages,
        windowMinutes: this.data.drafts.meme.windowMinutes,
        limit: this.data.drafts.meme.limit,
        intervalSeconds: this.data.drafts.meme.intervalSeconds,
      });
      if (!receipt.started) this.discoverError = receipt.error?.message ?? i18nHelper.coin.analysis.errors.discover;
    } catch (error) {
      console.error('[Coin] Discover start failed:', error);
      this.discoverError = i18nHelper.coin.analysis.errors.discover;
    } finally {
      this.discoverStarting = false;
    }
  }

  async stopDiscover(): Promise<void> {
    if (this.discoverStopping) return;
    this.discoverStopping = true;
    try {
      await window.coin.data.stopDiscover();
    } finally {
      this.discoverStopping = false;
    }
  }

  async evaluateStrategy(): Promise<void> {
    if (this.strategyLoading) return;
    this.strategyLoading = true;
    this.strategyError = '';
    try {
      const input = this.buildStrategyInput();
      const result = await window.coin.strategy.evaluate(input);
      this.strategyResult = result;
      this.strategyReceipt = {
        id: crypto.randomUUID(),
        source: 'strategy-v1',
        mode: 'deterministic',
        status: 'ready',
        observedAt: result.generatedAt,
        receivedAt: Date.now(),
        stale: false,
        reason: null,
        evidenceIds: [...new Set(result.reasons.flatMap((reason) => reason.evidenceRefs))].slice(0, 64),
      };
      this.appendReceipts([this.strategyReceipt]);
      const stored = {
        id: result.id,
        asset: input.asset.contractAddress,
        chain: input.asset.chain,
        createdAt: result.generatedAt,
        input: clone(input),
        result: clone(result),
      };
      this.data.decisions = [...this.data.decisions, stored].slice(-MAX_DECISIONS);
      this.data.history = [...this.data.history, {
        id: crypto.randomUUID(),
        type: 'decision' as const,
        asset: input.asset.contractAddress,
        chain: input.asset.chain,
        summary: `${result.decision} · ${result.score}/100`,
        createdAt: result.generatedAt,
        analysisId: null,
        decisionId: result.id,
        sourceReceiptIds: [this.strategyReceipt.id],
      }].slice(-MAX_HISTORY);
      this.queuePersist();
    } catch (error) {
      console.error('[Coin] Strategy evaluation failed:', error);
      this.strategyError = error instanceof Error && error.message
        ? `${i18nHelper.coin.analysis.errors.strategy}: ${error.message}`
        : i18nHelper.coin.analysis.errors.strategy;
    } finally {
      this.strategyLoading = false;
    }
  }

  aiReceiptFor(kind: CoinAiTargetKind, resultId: string): CoinAiAnalysisReceipt | null {
    return [...this.data.ai.receipts]
      .reverse()
      .find((receipt) =>
        receipt.target.kind === kind && receipt.target.resultId === resultId) ?? null;
  }

  aiErrorFor(kind: CoinAiTargetKind, resultId: string): string {
    return this.aiTarget?.kind === kind && this.aiTarget.resultId === resultId
      ? this.aiError
      : '';
  }

  isAiRunning(kind: CoinAiTargetKind, resultId: string): boolean {
    return Boolean(
      this.aiLoading &&
      this.aiTarget?.kind === kind &&
      this.aiTarget.resultId === resultId,
    );
  }

  async analyzeWithAi(
    kind: CoinAiTargetKind,
    resultId: string,
    userThesis = '',
  ): Promise<void> {
    if (this.aiLoading || !resultId) return;
    const runId = crypto.randomUUID();
    const target: CoinAiAnalysisTarget = { kind, resultId };
    this.aiRunId = runId;
    this.aiTarget = target;
    this.aiLoading = true;
    this.aiCancelling = false;
    this.aiError = '';
    this.persistAfterAi = false;

    try {
      const codex = await window.coin.codex.getStatus();
      if (!codex.connected) {
        this.aiError = this.aiErrorMessage('not-connected');
        this.setActivePage('resources');
        return;
      }
      if (!(await this.flushStateBeforeAi())) {
        this.aiError = i18nHelper.coin.analysis.errors.stateSave;
        return;
      }

      const response = await window.coin.ai.analyze({
        runId,
        target,
        model: this.data.ai.model,
        effort: this.data.ai.effort,
        userThesis,
      });
      if (this.aiRunId !== runId || response.runId !== runId) return;
      if (response.status === 'completed') {
        this.revision = response.snapshot.revision;
        this.data.ai = clone(response.snapshot.data.ai);
        this.stateConflict = false;
        this.stateError = '';
        Message.success(i18nHelper.coin.analysis.ai.completed);
      } else if (response.status === 'error') {
        this.aiError = this.aiErrorMessage(response.error.code);
        if (response.error.code === 'not-connected') this.setActivePage('resources');
      }
    } catch (error) {
      console.error('[Coin] Structured AI analysis failed:', error);
      if (this.aiRunId === runId) this.aiError = i18nHelper.coin.analysis.errors.ai;
    } finally {
      if (this.aiRunId === runId) {
        this.aiLoading = false;
        this.aiCancelling = false;
        this.aiRunId = null;
        if (this.persistAfterAi) {
          this.persistAfterAi = false;
          this.queuePersist();
        }
      }
    }
  }

  async cancelAi(): Promise<void> {
    const runId = this.aiRunId;
    if (!runId || !this.aiLoading || this.aiCancelling) return;
    this.aiCancelling = true;
    try {
      await window.coin.ai.cancel({ runId });
    } catch (error) {
      console.error('[Coin] AI cancellation failed:', error);
    } finally {
      if (this.aiRunId === runId) this.aiCancelling = false;
    }
  }

  updateAiPreference(): void {
    this.queuePersist();
  }

  evidenceAnchorId(evidenceId: string): string {
    let hash = 2166136261;
    for (let index = 0; index < evidenceId.length; index += 1) {
      hash ^= evidenceId.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `coin-evidence-${(hash >>> 0).toString(16)}`;
  }

  revealEvidence(evidenceId: string): void {
    const element = document.getElementById(this.evidenceAnchorId(evidenceId)) ??
      [...document.querySelectorAll<HTMLElement>('[data-coin-evidence]')]
        .find((candidate) =>
          candidate.dataset.coinEvidence?.split('\n').includes(evidenceId));
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('coin-evidence-anchor--active');
      window.setTimeout(() => element.classList.remove('coin-evidence-anchor--active'), 1_800);
      return;
    }
    void coinShellStore.openSources();
  }

  openHistory(entry: CoinHistoryEntry): void {
    if (entry.analysisId) {
      const analysis = this.data.analyses.find(({ id }) => id === entry.analysisId);
      if (!analysis) return;
      if (analysis.type === 'meme' && analysis.result.schema === 'coin-meme-analysis-v1') {
        this.selectToken(analysis.result.asset.chain, analysis.result.asset.contractAddress);
      }
      return;
    }
    if (entry.decisionId) {
      const decision = this.data.decisions.find(({ id }) => id === entry.decisionId);
      if (!decision) return;
      this.selectToken(decision.chain, decision.asset);
      this.strategyResult = clone(decision.result);
      this.applyStrategyInputToDraft(decision.input);
    }
  }

  history(type: CoinHistoryType | 'all', chain: string, search: string): CoinHistoryEntry[] {
    const needle = search.trim().toLowerCase();
    return [...this.data.history]
      .reverse()
      .filter((entry) => type === 'all' || entry.type === type)
      .filter((entry) => chain === 'all' || entry.chain === chain)
      .filter((entry) => !needle || entry.asset.toLowerCase().includes(needle) || entry.summary.toLowerCase().includes(needle));
  }

  private async performInitialize(): Promise<void> {
    this.stateLoading = true;
    this.attachEvents();
    try {
      const [stateResult] = await Promise.all([
        window.coin.state.load(),
        this.refreshSources(),
      ]);
      if (stateResult.status === 'malformed') {
        this.stateMalformed = true;
        this.stateError = i18nHelper.coin.analysis.state.malformed;
      } else {
        this.revision = stateResult.snapshot.revision;
        this.data = clone(stateResult.snapshot.data);
        if (
          this.revision === 0 &&
          this.sourceStatuses.find((source) => source.source === 'meme-service')?.configured
        ) {
          this.data.drafts.meme.mode = 'service';
        }
        this.restoreLatestResults();
        this.setShellPage(this.data.activePage);
      }
    } catch (error) {
      console.error('[Coin] Workspace initialization failed:', error);
      this.stateError = i18nHelper.coin.analysis.errors.stateLoad;
    } finally {
      this.stateLoading = false;
      this.initialized = true;
    }
  }

  private attachEvents(): void {
    if (!monitorUnsubscribe) {
      monitorUnsubscribe = window.coin.data.onMonitorEvent((event) => this.onMonitorEvent(event));
    }
    if (!discoverUnsubscribe) {
      discoverUnsubscribe = window.coin.data.onDiscoverEvent((snapshot) => {
        this.discoverSnapshot = snapshot;
        this.discoverError = snapshot.error?.message ?? '';
        this.appendReceipts(snapshot.receipts);
      });
    }
  }

  private onMonitorEvent(event: CoinMonitorEvent): void {
    this.appendReceipts([event.receipt]);
    if (!this.monitorResult) return;
    if (event.type === 'connection') {
      this.monitorResult = { ...this.monitorResult, connection: event.connection };
      if (event.reason && event.connection === 'error') this.monitorError = event.reason;
      return;
    }
    const rows = [...this.monitorResult.rows];
    const index = rows.findIndex(({ symbol }) => symbol === event.row.symbol);
    if (index >= 0) rows[index] = event.row;
    this.monitorResult = {
      ...this.monitorResult,
      rows,
      readAt: event.receipt.receivedAt,
      receipts: [event.receipt],
    };
  }

  private consumeEnvelopeError<T>(
    envelope: CoinDataEnvelope<T>,
    setError: (message: string) => void,
  ): void {
    setError(envelope.error?.message ?? '');
  }

  private recordAnalysis(
    type: CoinStoredAnalysis['type'],
    asset: string,
    chain: CoinStoredAnalysis['chain'],
    result: CoinStoredAnalysis['result'],
    receipts: CoinSourceReceipt[],
  ): void {
    const id = type === 'meme' && result.schema === 'coin-meme-analysis-v1' ? result.id : crypto.randomUUID();
    const createdAt = type === 'monitor' && result.schema === 'coin-monitor-v1'
      ? result.readAt
      : type === 'screener' && result.schema === 'coin-screener-v1'
        ? result.generatedAt
        : type === 'meme' && result.schema === 'coin-meme-analysis-v1'
          ? result.generatedAt
          : Date.now();
    const analysis: CoinStoredAnalysis = { id, type, chain, asset, createdAt, result: clone(result) } as CoinStoredAnalysis;
    this.data.analyses = [...this.data.analyses, analysis].slice(-MAX_ANALYSES);
    this.data.history = [...this.data.history, {
      id: crypto.randomUUID(),
      type,
      asset,
      chain,
      summary: this.analysisSummary(type, result),
      createdAt,
      analysisId: id,
      decisionId: null,
      sourceReceiptIds: receipts.map(({ id: receiptId }) => receiptId),
    }].slice(-MAX_HISTORY);
    this.appendReceipts(receipts);
    this.queuePersist();
  }

  private analysisSummary(type: CoinStoredAnalysis['type'], result: CoinStoredAnalysis['result']): string {
    if (type === 'monitor' && result.schema === 'coin-monitor-v1') return `${result.rows.length} symbols · ${result.connection}`;
    if (type === 'screener' && result.schema === 'coin-screener-v1') return `${result.matched}/${result.scanned} matched · ${result.mode}`;
    if (type === 'meme' && result.schema === 'coin-meme-analysis-v1') {
      return `${result.asset.symbol.value ?? result.asset.contractAddress} · ${result.mode}`;
    }
    return type;
  }

  private appendReceipts(receipts: CoinSourceReceipt[]): void {
    if (receipts.length === 0) return;
    const byId = new Map(this.data.sourceReceipts.map((receipt) => [receipt.id, receipt]));
    receipts.forEach((receipt) => byId.set(receipt.id, clone(receipt)));
    this.data.sourceReceipts = [...byId.values()].slice(-MAX_RECEIPTS);
    this.queuePersist();
  }

  private addWatchSymbols(symbols: string[]): void {
    const keys = new Set(this.data.watchlist.map((item) => `${item.kind}:${item.asset}:${item.chain ?? ''}`));
    const additions: CoinWatchItem[] = symbols
      .filter((symbol) => !keys.has(`symbol:${symbol}:`))
      .map((symbol) => ({ id: crypto.randomUUID(), kind: 'symbol', asset: symbol, chain: null, createdAt: Date.now() }));
    this.data.watchlist = [...this.data.watchlist, ...additions].slice(-500);
  }

  private selectToken(
    chain: NonNullable<CoinWatchItem['chain']>,
    asset: string,
  ): void {
    this.data.drafts.meme.chain = chain;
    this.data.drafts.meme.contractAddress = asset;
    this.data.drafts.meme.view = 'analyze';
    this.data.activePage = 'meme';
    this.commandError = '';
    this.memeDetectedChains = [chain];
    const analysis = [...this.data.analyses]
      .reverse()
      .find((item) =>
        item.type === 'meme' &&
        item.chain === chain &&
        contractAddressMatches(chain, item.asset, asset));
    if (analysis?.result.schema === 'coin-meme-analysis-v1') {
      this.replaceMemeAnalysis(clone(analysis.result));
      this.applyAnalysisToStrategy(analysis.result);
    } else {
      this.replaceMemeAnalysis(null);
    }
    coinShellStore.closeSecondary();
    this.queuePersist();
  }

  private replaceMemeAnalysis(result: CoinMemeAnalysisResult | null): void {
    const current = this.memeAnalysis?.asset ?? null;
    const targetChanged = Boolean(
      current &&
      (!result || !this.tokensMatch(
        current.chain,
        current.contractAddress,
        result.asset.chain,
        result.asset.contractAddress,
      )),
    );
    if (targetChanged) {
      this.data.drafts.decision.thesis = '';
      this.decisionError = '';
    }
    this.memeAnalysis = result;
  }

  private addFocusToken(asset: string, chain: CoinWatchItem['chain']): void {
    if (this.data.watchlist.some((item) =>
      item.kind === 'token' &&
      item.chain === chain &&
      contractAddressMatches(chain, item.asset, asset))) return;
    const watchItem: CoinWatchItem = {
      id: crypto.randomUUID(),
      kind: 'token',
      asset,
      chain,
      createdAt: Date.now(),
    };
    this.data.watchlist = [...this.data.watchlist, watchItem].slice(-500);
    this.queuePersist();
  }

  private applyAnalysisToStrategy(result: CoinMemeAnalysisResult): void {
    const draft = this.data.drafts.strategy;
    draft.chain = result.asset.chain;
    draft.contractAddress = result.asset.contractAddress;
    if (result.asset.launchStage.value) draft.launchStage = result.asset.launchStage.value;
    if (result.asset.priceUsd.value !== null) draft.priceUsd = result.asset.priceUsd.value;
    if (result.asset.liquidityUsd.value !== null) draft.liquidityUsd = result.asset.liquidityUsd.value;
    draft.snapshotAgeSeconds = Math.max(0, Math.floor((Date.now() - result.generatedAt) / 1000));
    if (result.confidence.value !== null) draft.dataConfidence = result.confidence.value;
    if (result.deterministicScore.value !== null) {
      draft.holderHealthScore = result.deterministicScore.value;
      draft.liquidityScore ??= result.deterministicScore.value;
    }
    draft.honeypotConfirmed = result.risks.some(({ code, severity }) => code.includes('HONEYPOT') && severity === 'critical');
    draft.criticalSourceConflict = result.risks.some(({ code }) => code === 'CHAIN_IDENTITY_MISMATCH');
    draft.sellable = !result.risks.some(({ code }) => ['HONEYPOT_FLAG', 'ASSET_ACCOUNT_UNVERIFIED'].includes(code));
    this.queuePersist();
  }

  private buildStrategyInput(): CoinStrategyInput {
    const draft = this.data.drafts.strategy;
    const sourceEvidence = [...new Set(this.memeAnalysis?.receipts.flatMap((receipt) => receipt.evidenceIds) ?? [])].slice(0, 24);
    const ownerEvidence = [
      { id: 'owner:asset', label: 'Owner-supplied asset identity and age', source: 'owner_input' as const },
      { id: 'owner:market', label: 'Owner-supplied market snapshot', source: 'owner_input' as const },
      { id: 'owner:execution', label: 'Owner-supplied execution and risk budget', source: 'owner_input' as const },
      { id: 'owner:signals', label: 'Owner-supplied structured signal scores', source: 'owner_input' as const },
      { id: 'owner:forecast', label: 'Owner-supplied point-in-time forecast', source: 'owner_input' as const },
      { id: 'owner:risk', label: 'Owner-supplied hard risk state', source: 'owner_input' as const },
      ...(draft.hasPosition ? [{ id: 'owner:position', label: 'Owner-supplied live position', source: 'owner_input' as const }] : []),
    ];
    const evidence = [
      ...ownerEvidence,
      ...sourceEvidence.map((id) => ({ id, label: 'Meme analysis source evidence', source: 'source' as const })),
    ];
    const sourceOr = (owner: string): string[] => sourceEvidence.length > 0 ? [...sourceEvidence, owner] : [owner];
    return {
      schema: 'coin-strategy-input-v1',
      asset: {
        chain: draft.chain,
        contractAddress: draft.contractAddress.trim() || (() => { throw new Error(i18nHelper.coin.analysis.errors.contractRequired); })(),
        launchStage: draft.launchStage,
        tokenAgeMinutes: finite(draft.tokenAgeMinutes, i18nHelper.coin.analysis.fields.tokenAge),
      },
      market: {
        priceUsd: finite(draft.priceUsd, i18nHelper.coin.analysis.fields.price, { positive: true }),
        liquidityUsd: finite(draft.liquidityUsd, i18nHelper.coin.analysis.fields.liquidity),
        snapshotAgeSeconds: finite(draft.snapshotAgeSeconds, i18nHelper.coin.analysis.fields.snapshotAge),
      },
      execution: {
        plannedEntryAmount: draft.hasPosition
          ? draft.plannedEntryAmount ?? 0
          : finite(draft.plannedEntryAmount, i18nHelper.coin.analysis.fields.plannedEntry, { positive: true }),
        riskBudget: finite(draft.riskBudget, i18nHelper.coin.analysis.fields.riskBudget),
        roundTripCostPct: finite(draft.roundTripCostPct, i18nHelper.coin.analysis.fields.roundTripCost, { max: 100 }),
      },
      signals: {
        walletOverlapScore: finite(draft.walletOverlapScore, i18nHelper.coin.analysis.fields.walletOverlap, { max: 100 }),
        attentionPotentialScore: finite(draft.attentionPotentialScore, i18nHelper.coin.analysis.fields.attention, { max: 100 }),
        momentumScore: finite(draft.momentumScore, i18nHelper.coin.analysis.fields.momentum, { max: 100 }),
        buyerQualityScore: finite(draft.buyerQualityScore, i18nHelper.coin.analysis.fields.buyerQuality, { max: 100 }),
        holderHealthScore: finite(draft.holderHealthScore, i18nHelper.coin.analysis.fields.holderHealth, { max: 100 }),
        liquidityScore: finite(draft.liquidityScore, i18nHelper.coin.analysis.fields.liquidityScore, { max: 100 }),
        smartMoneyFlowScore: finite(draft.smartMoneyFlowScore, i18nHelper.coin.analysis.fields.smartMoney, { max: 100 }),
        graduationScore: finite(draft.graduationScore, i18nHelper.coin.analysis.fields.graduation, { max: 100 }),
        riskScore: finite(draft.riskScore, i18nHelper.coin.analysis.fields.riskScore, { max: 100 }),
        dataConfidence: finite(draft.dataConfidence, i18nHelper.coin.analysis.fields.confidence, { max: 1 }),
      },
      forecast: {
        modelVersion: 'owner-point-in-time-v1',
        horizonMinutes: 60,
        winProbability: finite(draft.winProbability, i18nHelper.coin.analysis.fields.winProbability, { max: 1 }),
        expectedUpsidePctGivenWin: finite(draft.expectedUpsidePctGivenWin, i18nHelper.coin.analysis.fields.expectedUpside),
        expectedDownsidePctGivenLoss: finite(draft.expectedDownsidePctGivenLoss, i18nHelper.coin.analysis.fields.expectedDownside),
      },
      risk: {
        sellable: draft.sellable,
        honeypotConfirmed: draft.honeypotConfirmed,
        criticalSourceConflict: draft.criticalSourceConflict,
      },
      position: draft.hasPosition ? {
        entryPrice: finite(draft.entryPrice, i18nHelper.coin.analysis.fields.entryPrice, { positive: true }),
        remainingAmount: finite(draft.remainingAmount, i18nHelper.coin.analysis.fields.remainingAmount, { positive: true }),
        investedAmount: finite(draft.investedAmount, i18nHelper.coin.analysis.fields.investedAmount, { positive: true }),
        peakPrice: draft.peakPrice === null ? null : finite(draft.peakPrice, i18nHelper.coin.analysis.fields.peakPrice, { positive: true }),
        heldMinutes: finite(draft.heldMinutes, i18nHelper.coin.analysis.fields.heldMinutes),
      } : null,
      evidence,
      evidenceRefs: {
        asset: sourceOr('owner:asset'),
        market: sourceOr('owner:market'),
        execution: ['owner:execution'],
        signals: sourceOr('owner:signals'),
        forecast: ['owner:forecast'],
        risk: sourceOr('owner:risk'),
        position: draft.hasPosition ? ['owner:position'] : [],
      },
    };
  }

  private applyStrategyInputToDraft(input: CoinStrategyInput): void {
    const position = input.position;
    this.data.drafts.strategy = {
      chain: input.asset.chain,
      contractAddress: input.asset.contractAddress,
      launchStage: input.asset.launchStage,
      tokenAgeMinutes: input.asset.tokenAgeMinutes,
      priceUsd: input.market.priceUsd,
      liquidityUsd: input.market.liquidityUsd,
      snapshotAgeSeconds: input.market.snapshotAgeSeconds,
      plannedEntryAmount: input.execution.plannedEntryAmount,
      riskBudget: input.execution.riskBudget,
      roundTripCostPct: input.execution.roundTripCostPct,
      walletOverlapScore: input.signals.walletOverlapScore,
      attentionPotentialScore: input.signals.attentionPotentialScore,
      momentumScore: input.signals.momentumScore,
      buyerQualityScore: input.signals.buyerQualityScore,
      holderHealthScore: input.signals.holderHealthScore,
      liquidityScore: input.signals.liquidityScore,
      smartMoneyFlowScore: input.signals.smartMoneyFlowScore,
      graduationScore: input.signals.graduationScore,
      riskScore: input.signals.riskScore,
      dataConfidence: input.signals.dataConfidence,
      winProbability: input.forecast.winProbability,
      expectedUpsidePctGivenWin: input.forecast.expectedUpsidePctGivenWin,
      expectedDownsidePctGivenLoss: input.forecast.expectedDownsidePctGivenLoss,
      sellable: input.risk.sellable,
      honeypotConfirmed: input.risk.honeypotConfirmed,
      criticalSourceConflict: input.risk.criticalSourceConflict,
      hasPosition: position !== null,
      entryPrice: position?.entryPrice ?? null,
      remainingAmount: position?.remainingAmount ?? null,
      investedAmount: position?.investedAmount ?? null,
      peakPrice: position?.peakPrice ?? null,
      heldMinutes: position?.heldMinutes ?? null,
    };
    this.queuePersist();
  }

  private restoreLatestResults(): void {
    this.monitorResult = null;
    this.screenerParseResult = null;
    this.screenerResult = null;
    this.memeAnalysis = null;
    this.memeDetectedChains = [];
    this.discoverSnapshot = null;
    this.strategyResult = null;
    this.strategyReceipt = null;
    const latest = (type: CoinStoredAnalysis['type']) => [...this.data.analyses].reverse().find((analysis) => analysis.type === type);
    const monitor = latest('monitor');
    const screener = latest('screener');
    const meme = latest('meme');
    if (monitor?.result.schema === 'coin-monitor-v1') this.monitorResult = clone(monitor.result);
    if (screener?.result.schema === 'coin-screener-v1') this.screenerResult = clone(screener.result);
    if (meme?.result.schema === 'coin-meme-analysis-v1') {
      this.memeAnalysis = clone(meme.result);
      this.memeDetectedChains = [meme.result.asset.chain];
    }
    const decision = this.data.decisions.at(-1);
    if (decision) {
      this.strategyResult = clone(decision.result);
      const receipt = [...this.data.sourceReceipts]
        .reverse()
        .find((item) => item.source === 'strategy-v1' && item.observedAt === decision.createdAt);
      this.strategyReceipt = receipt ? clone(receipt) : null;
    }
  }

  private setShellPage(page: CoinPersistentData['activePage']): void {
    if (page === 'resources') coinShellStore.openResources();
    else if (page === 'history') coinShellStore.openHistory();
    else coinShellStore.closeSecondary();
  }

  private async flushStateBeforeAi(): Promise<boolean> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await this.persist();
    await saveQueue;
    return !this.stateMalformed && !this.stateConflict && !this.stateError;
  }

  private aiErrorMessage(code: CoinAiRunErrorCode): string {
    return i18nHelper.coin.analysis.aiErrors[code];
  }

  private async persist(): Promise<void> {
    const operation = saveQueue.then(async () => {
      this.stateSaving = true;
      const boundedData = this.boundedPersistentData();
      const result = await window.coin.state.save({
        expectedRevision: this.revision,
        data: boundedData,
      });
      if (result.status === 'saved') {
        this.revision = result.snapshot.revision;
        this.data = clone(result.snapshot.data);
        this.stateConflict = false;
        this.stateError = '';
      } else if (result.status === 'conflict') {
        this.stateConflict = true;
        this.stateError = i18nHelper.coin.analysis.state.conflict;
      } else {
        this.stateMalformed = true;
        this.stateConflict = false;
        this.stateError = i18nHelper.coin.analysis.state.malformed;
      }
    });
    saveQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    try {
      await operation;
    } catch (error) {
      console.error('[Coin] State save failed:', error);
      this.stateError = i18nHelper.coin.analysis.errors.stateSave;
    } finally {
      this.stateSaving = false;
    }
  }

  private boundedPersistentData(): CoinPersistentData {
    const data = clone(this.data);
    const size = (): number => new TextEncoder().encode(JSON.stringify(data)).byteLength;
    const compactHistory = (): void => {
      const analysisIds = new Set(data.analyses.map(({ id }) => id));
      const decisionIds = new Set(data.decisions.map(({ id }) => id));
      const receiptIds = new Set(data.sourceReceipts.map(({ id }) => id));
      data.history = data.history
        .filter((entry) => (!entry.analysisId || analysisIds.has(entry.analysisId)) && (!entry.decisionId || decisionIds.has(entry.decisionId)))
        .map((entry) => ({
          ...entry,
          sourceReceiptIds: entry.sourceReceiptIds.filter((id) => receiptIds.has(id)),
        }));
    };
    while (size() > MAX_PERSISTED_BYTES) {
      if (data.analyses.length > 1) data.analyses.shift();
      else if (data.sourceReceipts.length > 100) data.sourceReceipts.shift();
      else if (data.history.length > 100) data.history.shift();
      else if (data.ai.receipts.length > 20) data.ai.receipts.shift();
      else if (data.decisions.length > 50) data.decisions.shift();
      else if (data.analyses.length > 0) data.analyses.shift();
      else break;
      compactHistory();
    }
    return data;
  }
}

export const coinWorkspaceStore = reactive<CoinWorkspaceState>(new CoinWorkspaceState());
