import { randomUUID } from 'node:crypto';
import type {
  CoinCancelReceipt,
  CoinDataEnvelope,
  CoinDataError,
  CoinDataSourceStatus,
  CoinDiscoverCandidate,
  CoinDiscoverInput,
  CoinDiscoverSnapshot,
  CoinDiscoverStartReceipt,
  CoinDiscoverStopReceipt,
  CoinMemeAnalysisResult,
  CoinMonitorEvent,
  CoinMonitorResult,
  CoinReceiptState,
  CoinScreenerParseResult,
  CoinScreenerResult,
  CoinSourceId,
  CoinSourceReceipt,
} from '@shared/coin/coinAnalysis.type';
import type { CoinResourceChain } from '@shared/coin/coinResource.type';
import type { AlchemyResourceService } from '../resources/alchemyResource.service';
import { AlchemyReadError } from '../resources/alchemyResource.service';
import type { GmgnCliService, GmgnReadInput, GmgnReadResult } from '../resources/gmgnCli.service';
import { GmgnReadError } from '../resources/gmgnCli.service';
import type { ServiceEndpointService } from '../resources/serviceEndpoint.service';
import { CoinHttpClient, CoinHttpError, appendCoinServicePath } from './coinHttp.client';
import {
  createSourceReceipt,
  normalizeMonitorPayload,
  normalizeMonitorWebSocketPayload,
  normalizeScreenerParsePayload,
  normalizeScreenerPayload,
} from './coinData.normalize';
import {
  parseCancelInput,
  parseDiscoverInput,
  parseMemeAnalyzeInput,
  parseMonitorInput,
  parseScreenerInput,
  parseScreenerParseInput,
} from './coinData.validation';
import { normalizeDiscoverCandidates } from './discover.normalize';
import {
  buildLocalMemeAnalysis,
  extractLocalHolderAddresses,
  normalizeMemeServicePayload,
  type LocalMemeReadSet,
} from './memeAnalysis.normalize';

interface CoinSocketMessageEvent {
  data: unknown;
}

export interface CoinWebSocketPort {
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: CoinSocketMessageEvent) => void): void;
  close(): void;
}

export interface CoinDataServiceDependencies {
  http: CoinHttpClient;
  services: ServiceEndpointService;
  gmgn: GmgnCliService;
  alchemy: AlchemyResourceService;
  createWebSocket(url: string): CoinWebSocketPort;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

interface RequestSuccess<T> {
  data: T;
  receipt: CoinSourceReceipt;
  status?: 'ready' | 'partial';
}

const sourceMode = (
  source: CoinSourceId,
  sample = false,
): CoinSourceReceipt['mode'] => {
  if (sample) return 'sample';
  if (source === 'monitor-ws') return 'websocket';
  if (source === 'meme-service') return 'service';
  if (source === 'gmgn-cli') return 'local_cli';
  if (source.startsWith('alchemy-')) return 'local_rpc';
  if (source === 'strategy-v1') return 'deterministic';
  return 'http';
};

const publicError = (error: unknown): CoinDataError => {
  if (error instanceof CoinHttpError) {
    const messages: Record<CoinHttpError['code'], string> = {
      cancelled: 'The request was cancelled.',
      'http-error': error.status === 429
        ? 'The configured source is rate limited.'
        : 'The configured source returned an HTTP error.',
      'invalid-response': 'The configured source returned an invalid JSON response.',
      'network-error': 'The configured source could not be reached.',
      'output-limit': 'The source response exceeded the bounded output limit.',
      timeout: 'The configured source timed out.',
    };
    return {
      code: error.status === 429 ? 'rate-limited' : error.code,
      message: messages[error.code],
      retryable: !['cancelled', 'invalid-response', 'output-limit'].includes(error.code),
    };
  }
  if (error instanceof GmgnReadError) {
    const messages: Record<GmgnReadError['code'], string> = {
      cancelled: 'The local GMGN read was cancelled.',
      'cli-missing': 'Install GMGN CLI from Resources before using local mode.',
      'invalid-input': 'The local GMGN read input is invalid.',
      'invalid-response': 'GMGN returned an unsupported JSON response.',
      'key-missing': 'Configure GMGN_API_KEY from Resources before using local mode.',
      'output-limit': 'GMGN output exceeded the bounded output limit.',
      'private-key-detected': 'Remove GMGN_PRIVATE_KEY before using read-only local mode.',
      'process-failed': 'The fixed read-only GMGN command failed.',
      'queue-full': 'The bounded local GMGN queue is full; wait before retrying.',
      'rate-limited': 'GMGN is rate limited; wait for the source cooldown.',
      timeout: 'The fixed read-only GMGN command timed out.',
      unauthorized: 'GMGN rejected the configured API key.',
    };
    return {
      code: error.code,
      message: messages[error.code],
      retryable: ['process-failed', 'rate-limited', 'timeout', 'queue-full'].includes(error.code),
    };
  }
  if (error instanceof AlchemyReadError) {
    const messages: Record<AlchemyReadError['code'], string> = {
      cancelled: 'The Alchemy read was cancelled.',
      'invalid-input': 'The chain address is invalid for Alchemy verification.',
      'invalid-response': 'Alchemy returned an unsupported read-only RPC response.',
      'not-configured': 'Configure Alchemy for the selected chain in Resources.',
      timeout: 'Alchemy verification timed out.',
    };
    return {
      code: `alchemy-${error.code}`,
      message: messages[error.code],
      retryable: error.code === 'timeout' || error.code === 'invalid-response',
    };
  }
  return {
    code: 'invalid-source-response',
    message: 'The source response did not match the bounded Coin contract.',
    retryable: false,
  };
};

const unavailableError = (message: string): CoinDataError => ({
  code: 'source-unavailable',
  message,
  retryable: false,
});

export class CoinDataService {
  private readonly now: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly latestReceipts = new Map<CoinSourceId, CoinSourceReceipt>();
  private monitorSocket: CoinWebSocketPort | null = null;
  private monitorReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private monitorReconnectAttempts = 0;
  private monitorSymbols: string[] = [];
  private monitorConnection: CoinMonitorResult['connection'] = 'closed';
  private monitorListener: ((event: CoinMonitorEvent) => void) | null = null;
  private discoverController: AbortController | null = null;
  private discoverTimer: ReturnType<typeof setTimeout> | null = null;
  private discoverInput: CoinDiscoverInput | null = null;
  private discoverSnapshot: CoinDiscoverSnapshot | null = null;
  private discoverListener: ((snapshot: CoinDiscoverSnapshot) => void) | null = null;

  constructor(private readonly dependencies: CoinDataServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
  }

  async getSources(): Promise<CoinDataSourceStatus[]> {
    const serviceStatuses = this.dependencies.services.getStatuses();
    const gmgn = await this.dependencies.gmgn.detect();
    const alchemy = this.dependencies.alchemy.getStatuses();
    const serviceConfigured = (service: 'monitor' | 'screener' | 'meme') =>
      Boolean(serviceStatuses.find((status) => status.service === service)?.configured);
    const alchemyStatus = (chain: CoinResourceChain) =>
      alchemy.find((status) => status.chain === chain);
    const fromReceipt = (
      source: CoinSourceId,
      configured: boolean,
      support: CoinDataSourceStatus['support'],
      reason: string | null,
      cooldownUntil: number | null = null,
    ): CoinDataSourceStatus => {
      const receipt = this.latestReceipts.get(source);
      return {
        source,
        configured,
        support,
        state: receipt?.status ?? (configured ? 'ready' : 'unavailable'),
        lastObservedAt: receipt?.observedAt ?? null,
        cooldownUntil,
        reason: receipt?.reason ?? reason,
      };
    };
    const gmgnConfigured = gmgn.installed && gmgn.apiKeyConfigured && !gmgn.privateKeyDetected;
    return [
      fromReceipt('monitor-http', serviceConfigured('monitor'), 'read-only', serviceConfigured('monitor') ? null : 'Configure Monitor HTTP and WebSocket endpoints in Resources.'),
      fromReceipt('monitor-ws', serviceConfigured('monitor'), 'read-only', serviceConfigured('monitor') ? null : 'Configure Monitor HTTP and WebSocket endpoints in Resources.'),
      fromReceipt('screener', serviceConfigured('screener'), 'read-only', serviceConfigured('screener') ? null : 'Configure the Screener endpoint in Resources.'),
      fromReceipt('meme-service', serviceConfigured('meme'), 'read-only', serviceConfigured('meme') ? null : 'A deployed Meme service is optional when explicit local mode is configured.'),
      fromReceipt('gmgn-cli', gmgnConfigured, 'read-only', gmgnConfigured ? null : 'Install GMGN CLI and configure a personal API key.', this.dependencies.gmgn.readCooldownUntil || null),
      fromReceipt('alchemy-robinhood', Boolean(alchemyStatus('robinhood')?.configured), 'read-only', alchemyStatus('robinhood')?.configured ? null : 'Configure Alchemy Robinhood in Resources.'),
      fromReceipt('alchemy-bsc', Boolean(alchemyStatus('bsc')?.configured), 'read-only', alchemyStatus('bsc')?.configured ? null : 'Configure Alchemy BSC in Resources.'),
      fromReceipt('alchemy-solana', Boolean(alchemyStatus('solana')?.configured), 'read-only', alchemyStatus('solana')?.configured ? null : 'Configure Alchemy Solana in Resources.'),
      fromReceipt('owner-cohorts', false, 'unavailable', 'No reviewed owner cohort registry is configured.'),
      fromReceipt('strategy-v1', true, 'read-only', null),
    ];
  }

  async monitor(
    value: unknown,
    listener: (event: CoinMonitorEvent) => void,
  ): Promise<CoinDataEnvelope<CoinMonitorResult>> {
    const input = parseMonitorInput(value);
    this.monitorListener = listener;
    const endpoint = this.resolveService('monitor');
    if (!endpoint) {
      return this.unavailableEnvelope('monitor-http', 'Configure Monitor HTTP and WebSocket endpoints in Resources.');
    }
    return await this.withRequest(input.requestId, 'monitor-http', async (signal) => {
      const url = new URL(appendCoinServicePath(endpoint.httpUrl, 'binance/futures/symbol-feature-states'));
      url.searchParams.set('symbols', input.symbols.join(','));
      const payload = await this.dependencies.http.requestJson({ url: url.href, method: 'GET', signal });
      const receipt = this.recordReceipt(createSourceReceipt({
        source: 'monitor-http',
        mode: 'http',
        status: 'ready',
        observedAt: this.now(),
        receivedAt: this.now(),
        evidenceIds: [`monitor-http:${this.now()}`],
      }));
      if (input.connectLive && endpoint.wsUrl) this.connectMonitor(endpoint.wsUrl, input.symbols, listener);
      else this.disconnectMonitor();
      return {
        data: normalizeMonitorPayload(payload, input.symbols, this.now(), receipt, this.monitorConnection),
        receipt,
      };
    });
  }

  async refreshMonitor(value: unknown): Promise<CoinDataEnvelope<CoinMonitorResult>> {
    const input = parseMonitorInput(value);
    const endpoint = this.resolveService('monitor');
    if (!endpoint) {
      return this.unavailableEnvelope('monitor-http', 'Configure Monitor HTTP and WebSocket endpoints in Resources.');
    }
    return await this.withRequest(input.requestId, 'monitor-http', async (signal) => {
      const payload = await this.dependencies.http.requestJson({
        url: appendCoinServicePath(endpoint.httpUrl, 'binance/futures/symbol-feature-states/refresh'),
        method: 'POST',
        body: { symbols: input.symbols },
        signal,
      });
      const receipt = this.recordReceipt(createSourceReceipt({
        source: 'monitor-http',
        mode: 'http',
        status: 'ready',
        observedAt: this.now(),
        receivedAt: this.now(),
        evidenceIds: [`monitor-refresh:${this.now()}`],
      }));
      return {
        data: normalizeMonitorPayload(payload, input.symbols, this.now(), receipt, this.monitorConnection),
        receipt,
      };
    });
  }

  async parseScreener(value: unknown): Promise<CoinDataEnvelope<CoinScreenerParseResult>> {
    const input = parseScreenerParseInput(value);
    const endpoint = this.resolveService('screener');
    if (!endpoint) return this.unavailableEnvelope('screener', 'Configure the Screener endpoint in Resources.');
    return await this.withRequest(input.requestId, 'screener', async (signal) => {
      const payload = await this.dependencies.http.requestJson({
        url: appendCoinServicePath(endpoint.httpUrl, 'api/coin-filter/parse'),
        method: 'POST',
        body: { query: input.query },
        signal,
      });
      const receipt = this.recordReceipt(createSourceReceipt({
        source: 'screener',
        mode: 'http',
        status: 'ready',
        observedAt: this.now(),
        receivedAt: this.now(),
        evidenceIds: [`screener-parse:${this.now()}`],
      }));
      return { data: normalizeScreenerParsePayload(payload, input.query, receipt), receipt };
    });
  }

  async screen(value: unknown): Promise<CoinDataEnvelope<CoinScreenerResult>> {
    const input = parseScreenerInput(value);
    const endpoint = this.resolveService('screener');
    if (!endpoint) return this.unavailableEnvelope('screener', 'Configure the Screener endpoint in Resources.');
    return await this.withRequest(input.requestId, 'screener', async (signal) => {
      const payload = await this.dependencies.http.requestJson({
        url: appendCoinServicePath(endpoint.httpUrl, 'api/coin-filter/screen'),
        method: 'POST',
        body: {
          query: input.query,
          mode: input.mode,
          symbols: input.symbols.length > 0 ? input.symbols : undefined,
          maxSymbols: input.maxSymbols,
          limit: input.limit,
          filters: input.filters,
        },
        signal,
      });
      const receipt = this.recordReceipt(createSourceReceipt({
        source: 'screener',
        mode: input.mode === 'sample' ? 'sample' : 'http',
        status: 'ready',
        observedAt: this.now(),
        receivedAt: this.now(),
        evidenceIds: [`screener:${input.mode}:${this.now()}`],
      }));
      return {
        data: normalizeScreenerPayload(payload, input.mode, receipt, this.now()),
        receipt,
      };
    });
  }

  async analyzeMeme(value: unknown): Promise<CoinDataEnvelope<CoinMemeAnalysisResult>> {
    const input = parseMemeAnalyzeInput(value);
    if (input.mode === 'service') return await this.analyzeMemeService(input);
    return await this.analyzeMemeLocal(input);
  }

  async startDiscover(
    value: unknown,
    listener: (snapshot: CoinDiscoverSnapshot) => void,
  ): Promise<CoinDiscoverStartReceipt> {
    const input = parseDiscoverInput(value);
    this.stopDiscover();
    const prerequisite = await this.discoverPrerequisite(input);
    if (prerequisite) {
      return {
        started: false,
        sessionId: '',
        mode: input.mode,
        intervalSeconds: input.intervalSeconds,
        error: prerequisite,
      };
    }
    const sessionId = randomUUID();
    this.discoverInput = input;
    this.discoverController = new AbortController();
    this.discoverListener = listener;
    this.discoverSnapshot = {
      schema: 'coin-discover-v1',
      sessionId,
      running: true,
      mode: input.mode,
      chain: input.chain,
      candidates: [],
      startedAt: this.now(),
      completedAt: null,
      nextPollAt: null,
      error: null,
      receipts: [],
    };
    listener(this.discoverSnapshot);
    void this.pollDiscover(sessionId);
    return {
      started: true,
      sessionId,
      mode: input.mode,
      intervalSeconds: input.intervalSeconds,
      error: null,
    };
  }

  stopDiscover(): CoinDiscoverStopReceipt {
    const sessionId = this.discoverSnapshot?.sessionId ?? null;
    this.discoverController?.abort();
    this.discoverController = null;
    if (this.discoverTimer) this.clearTimer(this.discoverTimer);
    this.discoverTimer = null;
    this.discoverInput = null;
    if (this.discoverSnapshot) {
      this.discoverSnapshot = {
        ...this.discoverSnapshot,
        running: false,
        nextPollAt: null,
      };
      this.discoverListener?.(this.discoverSnapshot);
    }
    return { stopped: sessionId !== null, sessionId };
  }

  cancel(value: unknown): CoinCancelReceipt {
    const input = parseCancelInput(value);
    const controller = this.activeRequests.get(input.requestId);
    if (!controller || controller.signal.aborted) {
      return { requestId: input.requestId, cancelled: false };
    }
    controller.abort();
    return { requestId: input.requestId, cancelled: true };
  }

  stopAll(): void {
    for (const controller of this.activeRequests.values()) controller.abort();
    this.activeRequests.clear();
    this.stopDiscover();
    this.discoverListener = null;
    this.disconnectMonitor();
    this.monitorListener = null;
  }

  private async analyzeMemeService(
    input: ReturnType<typeof parseMemeAnalyzeInput>,
  ): Promise<CoinDataEnvelope<CoinMemeAnalysisResult>> {
    const endpoint = this.resolveService('meme');
    if (!endpoint) {
      return this.unavailableEnvelope('meme-service', 'Configure the deployed Meme service or explicitly select Local CLI + RPC mode.');
    }
    return await this.withRequest(input.requestId, 'meme-service', async (signal) => {
      const payload = await this.dependencies.http.requestJson({
        url: appendCoinServicePath(endpoint.httpUrl, 'api/meme/analyze'),
        method: 'POST',
        body: {
          chain: input.chain,
          contractAddress: input.contractAddress,
          holderLimit: input.holderLimit,
          traderLimit: input.traderLimit,
        },
        signal,
        timeoutMs: 30_000,
        maxResponseBytes: 2 * 1024 * 1024,
      });
      const receipt = this.recordReceipt(createSourceReceipt({
        source: 'meme-service',
        mode: 'service',
        status: 'ready',
        observedAt: this.now(),
        receivedAt: this.now(),
        evidenceIds: [`meme-service:${input.chain}:${this.now()}`],
      }));
      return {
        data: normalizeMemeServicePayload(payload, input, receipt, this.now()),
        receipt,
      };
    });
  }

  private async analyzeMemeLocal(
    input: ReturnType<typeof parseMemeAnalyzeInput>,
  ): Promise<CoinDataEnvelope<CoinMemeAnalysisResult>> {
    const readiness = await this.localReadiness(input.chain);
    if (readiness) return this.unavailableEnvelope('gmgn-cli', readiness);
    return await this.withRequest(input.requestId, 'gmgn-cli', async (signal) => {
      const reads: LocalMemeReadSet = { receipts: [] };
      const failures: CoinDataError[] = [];
      const read = async (request: GmgnReadInput): Promise<GmgnReadResult | undefined> => {
        try {
          const result = await this.dependencies.gmgn.read(request, signal);
          const evidenceId = `gmgn:${result.operation}:${result.observedAt}`;
          reads.receipts.push(this.recordReceipt(createSourceReceipt({
            source: 'gmgn-cli',
            mode: 'local_cli',
            status: 'ready',
            observedAt: result.observedAt,
            receivedAt: this.now(),
            evidenceIds: [evidenceId],
          })));
          return result;
        } catch (error) {
          if (error instanceof GmgnReadError && error.code === 'cancelled') throw error;
          const failure = publicError(error);
          failures.push(failure);
          reads.receipts.push(this.recordReceipt(createSourceReceipt({
            source: 'gmgn-cli',
            mode: 'local_cli',
            status: failure.code === 'key-missing' || failure.code === 'cli-missing' ? 'unavailable' : 'error',
            observedAt: null,
            receivedAt: this.now(),
            reason: failure.message,
            evidenceIds: [`gmgn:${request.operation}:error:${this.now()}`],
          })));
          return undefined;
        }
      };
      reads.info = await read({ operation: 'token-info', chain: input.chain, address: input.contractAddress });
      reads.security = await read({ operation: 'token-security', chain: input.chain, address: input.contractAddress });
      reads.holders = await read({ operation: 'token-holders', chain: input.chain, address: input.contractAddress, limit: input.holderLimit });
      reads.traders = await read({ operation: 'token-traders', chain: input.chain, address: input.contractAddress, limit: input.traderLimit });
      reads.hotSearches = await read({ operation: 'hot-searches', chain: input.chain, interval: '1h', limit: 20 });
      reads.trending = await read({ operation: 'trending', chain: input.chain, interval: '1h', limit: 20 });
      if (!reads.info && !reads.holders && !reads.security && !reads.traders && !reads.hotSearches && !reads.trending) {
        throw new GmgnReadError((failures[0]?.code as GmgnReadError['code']) || 'process-failed');
      }

      const alchemySource = this.alchemySource(input.chain);
      try {
        reads.alchemy = await this.dependencies.alchemy.inspectAsset(
          input.chain,
          input.contractAddress,
          extractLocalHolderAddresses(reads),
          signal,
        );
        const evidenceId = `alchemy:${input.chain}:${reads.alchemy.observedAt}`;
        reads.receipts.push(this.recordReceipt(createSourceReceipt({
          source: alchemySource,
          mode: 'local_rpc',
          status: reads.alchemy.chainIdentityVerified && reads.alchemy.assetAccountVerified ? 'ready' : 'partial',
          observedAt: reads.alchemy.observedAt,
          receivedAt: this.now(),
          reason: reads.alchemy.chainIdentityVerified && reads.alchemy.assetAccountVerified
            ? null
            : 'Chain identity or asset account verification did not pass.',
          evidenceIds: [evidenceId],
        })));
      } catch (error) {
        if (error instanceof AlchemyReadError && error.code === 'cancelled') throw error;
        const failure = publicError(error);
        failures.push(failure);
        reads.alchemyReason = failure.message;
        reads.receipts.push(this.recordReceipt(createSourceReceipt({
          source: alchemySource,
          mode: 'local_rpc',
          status: error instanceof AlchemyReadError && error.code === 'not-configured' ? 'unavailable' : 'error',
          observedAt: null,
          receivedAt: this.now(),
          reason: failure.message,
          evidenceIds: [`alchemy:${input.chain}:error:${this.now()}`],
        })));
      }
      const aggregate = this.recordReceipt(createSourceReceipt({
        source: 'gmgn-cli',
        mode: 'local_cli',
        status: failures.length > 0 ? 'partial' : 'ready',
        observedAt: Math.max(...reads.receipts.map((receipt) => receipt.observedAt ?? 0)) || null,
        receivedAt: this.now(),
        reason: failures.length > 0 ? 'Local analysis completed with unavailable or failed source dimensions.' : null,
        evidenceIds: reads.receipts.flatMap((receipt) => receipt.evidenceIds),
      }));
      return {
        data: buildLocalMemeAnalysis(input, reads, this.now()),
        receipt: aggregate,
        status: failures.length > 0 ? 'partial' : 'ready',
      };
    });
  }

  private async withRequest<T>(
    requestId: string,
    source: CoinSourceId,
    operation: (signal: AbortSignal) => Promise<RequestSuccess<T>>,
  ): Promise<CoinDataEnvelope<T>> {
    if (this.activeRequests.has(requestId)) {
      return this.errorEnvelope(source, {
        code: 'duplicate-request',
        message: 'This request is already running.',
        retryable: false,
      });
    }
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    try {
      const result = await operation(controller.signal);
      return {
        status: result.status ?? 'ready',
        data: result.data,
        receipt: result.receipt,
        error: null,
      };
    } catch (error) {
      const publicFailure = publicError(error);
      const status = publicFailure.code === 'cancelled' || publicFailure.code === 'alchemy-cancelled'
        ? 'cancelled'
        : 'error';
      const receipt = this.recordReceipt(createSourceReceipt({
        source,
        mode: sourceMode(source),
        status: status === 'cancelled' ? 'error' : 'error',
        observedAt: null,
        receivedAt: this.now(),
        reason: publicFailure.message,
      }));
      return { status, data: null, receipt, error: publicFailure };
    } finally {
      if (this.activeRequests.get(requestId) === controller) this.activeRequests.delete(requestId);
    }
  }

  private unavailableEnvelope<T>(source: CoinSourceId, message: string): CoinDataEnvelope<T> {
    const error = unavailableError(message);
    const receipt = this.recordReceipt(createSourceReceipt({
      source,
      mode: sourceMode(source),
      status: 'unavailable',
      observedAt: null,
      receivedAt: this.now(),
      reason: message,
    }));
    return { status: 'unavailable', data: null, receipt, error };
  }

  private errorEnvelope<T>(source: CoinSourceId, error: CoinDataError): CoinDataEnvelope<T> {
    const receipt = this.recordReceipt(createSourceReceipt({
      source,
      mode: sourceMode(source),
      status: 'error',
      observedAt: null,
      receivedAt: this.now(),
      reason: error.message,
    }));
    return { status: 'error', data: null, receipt, error };
  }

  private resolveService(service: 'monitor' | 'screener' | 'meme') {
    try {
      return this.dependencies.services.resolve(service);
    } catch {
      return null;
    }
  }

  private recordReceipt(receipt: CoinSourceReceipt): CoinSourceReceipt {
    this.latestReceipts.set(receipt.source, receipt);
    return receipt;
  }

  private alchemySource(chain: CoinResourceChain): CoinSourceId {
    return chain === 'robinhood'
      ? 'alchemy-robinhood'
      : chain === 'bsc'
        ? 'alchemy-bsc'
        : 'alchemy-solana';
  }

  private connectMonitor(
    wsUrl: string,
    symbols: string[],
    listener: (event: CoinMonitorEvent) => void,
  ): void {
    this.disconnectMonitor(false);
    this.monitorSymbols = [...symbols];
    this.monitorListener = listener;
    this.monitorConnection = 'connecting';
    this.emitMonitorConnection('connecting', null);
    const socket = this.dependencies.createWebSocket(wsUrl);
    this.monitorSocket = socket;
    socket.addEventListener('open', () => {
      if (this.monitorSocket !== socket) return;
      this.monitorReconnectAttempts = 0;
      this.monitorConnection = 'live';
      this.emitMonitorConnection('live', null);
    });
    socket.addEventListener('message', (event) => {
      if (this.monitorSocket !== socket || typeof event.data !== 'string') return;
      if (Buffer.byteLength(event.data, 'utf8') > 256 * 1024) {
        this.emitMonitorConnection('error', 'Monitor WebSocket message exceeded the bounded limit.');
        socket.close();
        return;
      }
      try {
        const row = normalizeMonitorWebSocketPayload(JSON.parse(event.data) as unknown, this.monitorSymbols, this.now());
        if (!row) return;
        const receipt = this.recordReceipt(createSourceReceipt({
          source: 'monitor-ws',
          mode: 'websocket',
          status: row.state === 'stale' ? 'stale' : row.state === 'error' ? 'error' : 'ready',
          observedAt: row.observedAt,
          receivedAt: this.now(),
          reason: row.reason,
          evidenceIds: row.evidenceIds,
        }));
        this.monitorListener?.({ type: 'row', row, receipt });
      } catch {
        this.emitMonitorConnection('error', 'Monitor WebSocket returned invalid JSON.');
      }
    });
    socket.addEventListener('error', () => {
      if (this.monitorSocket === socket) this.emitMonitorConnection('error', 'Monitor WebSocket connection failed.');
    });
    socket.addEventListener('close', () => {
      if (this.monitorSocket !== socket) return;
      this.monitorSocket = null;
      if (this.monitorSymbols.length === 0) {
        this.monitorConnection = 'closed';
        this.emitMonitorConnection('closed', null);
        return;
      }
      this.monitorConnection = 'retrying';
      this.emitMonitorConnection('retrying', 'Monitor WebSocket closed; retry is scheduled.');
      this.monitorReconnectAttempts += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.monitorReconnectAttempts, 5));
      this.monitorReconnectTimer = this.setTimer(() => {
        this.monitorReconnectTimer = null;
        const endpoint = this.resolveService('monitor');
        if (endpoint?.wsUrl && this.monitorSymbols.length > 0 && this.monitorListener) {
          this.connectMonitor(endpoint.wsUrl, this.monitorSymbols, this.monitorListener);
        }
      }, delay);
    });
  }

  private disconnectMonitor(clearSymbols = true): void {
    if (this.monitorReconnectTimer) this.clearTimer(this.monitorReconnectTimer);
    this.monitorReconnectTimer = null;
    const socket = this.monitorSocket;
    this.monitorSocket = null;
    socket?.close();
    if (clearSymbols) this.monitorSymbols = [];
    this.monitorConnection = 'closed';
  }

  private emitMonitorConnection(
    connection: CoinMonitorResult['connection'],
    reason: string | null,
  ): void {
    const status: CoinReceiptState = connection === 'live'
      ? 'ready'
      : connection === 'error'
        ? 'error'
        : connection === 'closed'
          ? 'unavailable'
          : 'partial';
    const receipt = this.recordReceipt(createSourceReceipt({
      source: 'monitor-ws',
      mode: 'websocket',
      status,
      observedAt: connection === 'live' ? this.now() : null,
      receivedAt: this.now(),
      reason,
      evidenceIds: connection === 'live' ? [`monitor-ws:${this.now()}`] : [],
    }));
    this.monitorListener?.({ type: 'connection', connection, reason, receipt });
  }

  private async localReadiness(chain: CoinResourceChain): Promise<string | null> {
    const gmgn = await this.dependencies.gmgn.detect();
    if (!gmgn.installed) return 'Install GMGN CLI in Resources before selecting Local CLI + RPC.';
    if (gmgn.privateKeyDetected) return 'Remove GMGN_PRIVATE_KEY before using read-only local mode.';
    if (!gmgn.apiKeyConfigured) return 'Configure GMGN_API_KEY in Resources before selecting local mode.';
    const alchemy = this.dependencies.alchemy.getStatuses().find((status) => status.chain === chain);
    if (!alchemy?.configured) return `Configure Alchemy ${chain} in Resources before selecting local mode.`;
    return null;
  }

  private async discoverPrerequisite(input: CoinDiscoverInput): Promise<CoinDataError | null> {
    if (input.mode === 'service') {
      return this.resolveService('meme')
        ? null
        : unavailableError('Configure the deployed Meme service or explicitly select Local CLI + RPC mode.');
    }
    const reason = await this.localReadiness(input.chain);
    return reason ? unavailableError(reason) : null;
  }

  private async pollDiscover(sessionId: string): Promise<void> {
    const input = this.discoverInput;
    const controller = this.discoverController;
    const previous = this.discoverSnapshot;
    if (!input || !controller || !previous || previous.sessionId !== sessionId) return;
    const receipts: CoinSourceReceipt[] = [];
    try {
      const payloads: unknown[] = [];
      if (input.mode === 'service') {
        const endpoint = this.resolveService('meme');
        if (!endpoint) throw new CoinHttpError('network-error');
        payloads.push(await this.dependencies.http.requestJson({
          url: appendCoinServicePath(endpoint.httpUrl, 'api/meme/discover'),
          method: 'POST',
          body: {
            chain: input.chain,
            stages: input.stages,
            windowMinutes: input.windowMinutes,
            limit: input.limit,
          },
          signal: controller.signal,
          timeoutMs: 30_000,
          maxResponseBytes: 2 * 1024 * 1024,
        }));
        receipts.push(this.recordReceipt(createSourceReceipt({
          source: 'meme-service',
          mode: 'service',
          status: 'ready',
          observedAt: this.now(),
          receivedAt: this.now(),
          evidenceIds: [`meme-discover-service:${this.now()}`],
        })));
      } else {
        const types = [...new Set(input.stages.flatMap((stage) => {
          if (stage === 'discovered' || stage === 'filling') return ['new_creation' as const];
          if (stage === 'near_graduation' || stage === 'migration_pending') return ['near_completion' as const];
          if (stage === 'graduated_recently' || stage === 'dex_live') return ['completed' as const];
          return [];
        }))];
        const request: GmgnReadInput = {
          operation: 'trenches',
          chain: input.chain,
          types: types.length > 0 ? types : ['near_completion', 'completed'],
          limit: input.limit,
        };
        const result = await this.dependencies.gmgn.read(request, controller.signal);
        payloads.push(result.data);
        receipts.push(this.recordReceipt(createSourceReceipt({
          source: 'gmgn-cli',
          mode: 'local_cli',
          status: 'ready',
          observedAt: result.observedAt,
          receivedAt: this.now(),
          evidenceIds: [`gmgn:trenches:${result.observedAt}`],
        })));
      }
      const completedAt = this.now();
      const candidates = normalizeDiscoverCandidates(
        payloads,
        input,
        previous.candidates,
        receipts,
        completedAt,
      );
      this.discoverSnapshot = {
        ...previous,
        running: true,
        candidates,
        completedAt,
        nextPollAt: completedAt + input.intervalSeconds * 1000,
        error: null,
        receipts,
      };
      this.discoverListener?.(this.discoverSnapshot);
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = publicError(error);
      const completedAt = this.now();
      const source: CoinSourceId = input.mode === 'service' ? 'meme-service' : 'gmgn-cli';
      receipts.push(this.recordReceipt(createSourceReceipt({
        source,
        mode: input.mode === 'service' ? 'service' : 'local_cli',
        status: 'error',
        observedAt: null,
        receivedAt: completedAt,
        reason: failure.message,
      })));
      this.discoverSnapshot = {
        ...previous,
        running: true,
        completedAt,
        nextPollAt: completedAt + input.intervalSeconds * 1000,
        error: failure,
        receipts,
      };
      this.discoverListener?.(this.discoverSnapshot);
    }
    if (
      this.discoverController === controller &&
      !controller.signal.aborted &&
      this.discoverInput === input
    ) {
      this.discoverTimer = this.setTimer(() => {
        this.discoverTimer = null;
        void this.pollDiscover(sessionId);
      }, input.intervalSeconds * 1000);
    }
  }
}
