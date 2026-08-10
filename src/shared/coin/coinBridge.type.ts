import type { ApplicationLanguageSnapshot } from '@shared/i18n/applicationLanguage';
import type {
  CoinCodexActionReceipt,
  CoinCodexDeviceCodeNotice,
  CoinCodexLoginMethod,
  CoinCodexStatus,
  CoinGmgnOfficialLinkTarget,
  CoinGmgnProbeReceipt,
  CoinGmgnSaveReceipt,
  CoinGmgnStatus,
  CoinResourcesStatus,
  CoinServiceSaveInput,
  CoinServiceSaveReceipt,
} from './coinResource.type';
import type {
  CoinAiAnalyzeInput,
  CoinAiAnalyzeResult,
  CoinAiCancelInput,
  CoinAiCancelReceipt,
  CoinCancelInput,
  CoinCancelReceipt,
  CoinDataEnvelope,
  CoinDataSourceStatus,
  CoinDecisionResult,
  CoinDiscoverInput,
  CoinDiscoverSnapshot,
  CoinDiscoverStartReceipt,
  CoinDiscoverStopReceipt,
  CoinMemeAutoAnalysisResult,
  CoinMemeAutoAnalyzeInput,
  CoinMemeAnalysisResult,
  CoinMemeAnalyzeInput,
  CoinMonitorEvent,
  CoinMonitorInput,
  CoinMonitorResult,
  CoinScreenerInput,
  CoinScreenerParseInput,
  CoinScreenerParseResult,
  CoinScreenerResult,
  CoinStateLoadResult,
  CoinStateRecoveryResult,
  CoinStateSaveInput,
  CoinStateSaveResult,
  CoinStrategyInput,
  CoinXBrowserDisplayMode,
} from './coinAnalysis.type';

export const COIN_IPC_CHANNELS = {
  shellGetStatus: 'coin:shell:get-status',
  resourcesGetStatus: 'coin:resources:get-status',
  codexGetStatus: 'coin:codex:get-status',
  codexConnect: 'coin:codex:connect',
  codexDisconnect: 'coin:codex:disconnect',
  codexDeviceCode: 'coin:codex:device-code',
  gmgnDetect: 'coin:gmgn:detect',
  gmgnSaveApiKey: 'coin:gmgn:save-api-key',
  gmgnVerify: 'coin:gmgn:verify',
  gmgnCancelVerify: 'coin:gmgn:cancel-verify',
  gmgnOpenOfficialLink: 'coin:gmgn:open-official-link',
  serviceSave: 'coin:service:save',
  stateLoad: 'coin:state:load',
  stateSave: 'coin:state:save',
  stateRecover: 'coin:state:recover',
  dataGetSources: 'coin:data:get-sources',
  dataMonitor: 'coin:data:monitor',
  dataRefreshMonitor: 'coin:data:refresh-monitor',
  dataMonitorEvent: 'coin:data:monitor-event',
  dataParseScreener: 'coin:data:parse-screener',
  dataScreen: 'coin:data:screen',
  dataAnalyzeMeme: 'coin:data:analyze-meme',
  dataAutoAnalyzeMeme: 'coin:data:auto-analyze-meme',
  dataStartDiscover: 'coin:data:start-discover',
  dataStopDiscover: 'coin:data:stop-discover',
  dataDiscoverEvent: 'coin:data:discover-event',
  dataCancel: 'coin:data:cancel',
  strategyEvaluate: 'coin:strategy:evaluate',
  aiAnalyze: 'coin:ai:analyze',
  aiCancel: 'coin:ai:cancel',
  clipboardReadText: 'coin:clipboard:read-text',
  xBrowserGetStatus: 'coin:x-browser:get-status',
  xBrowserSetDisplayMode: 'coin:x-browser:set-display-mode',
  xBrowserOpen: 'coin:x-browser:open',
  xBrowserFocus: 'coin:x-browser:focus',
  xBrowserClose: 'coin:x-browser:close',
  languageGetCurrent: 'coin:language:get-current',
  languageChanged: 'coin:language:changed',
  windowMinimize: 'coin:window:minimize',
  windowToggleMaximize: 'coin:window:toggle-maximize',
  windowClose: 'coin:window:close',
} as const;

export type CoinHostPlatform = 'darwin' | 'win32' | 'other';
export interface CoinShellStatus {
  schema: 'coin-shell-v1';
  shell: 'ready';
  analysis: 'ready' | 'unavailable';
  codex: 'connected' | 'disconnected' | 'error';
}

export interface CoinWindowSnapshot {
  maximized: boolean;
}

export type CoinXBrowserState =
  | 'closed'
  | 'launching'
  | 'login_required'
  | 'ready'
  | 'error';

export type CoinXBrowserErrorCode =
  | 'chrome-unavailable'
  | 'profile-busy'
  | 'cdp-invalid'
  | 'cdp-unavailable'
  | 'display-mode-unavailable'
  | 'launch-failed'
  | 'navigation-failed';

export interface CoinXBrowserStatus {
  schema: 'coin-x-browser-v1';
  state: CoinXBrowserState;
  mode: 'managed_profile' | 'cdp';
  displayMode: CoinXBrowserDisplayMode | 'external';
  errorCode: CoinXBrowserErrorCode | null;
  openedAt: number | null;
}

export interface CoinXBrowserOpenInput {
  query: string;
  displayMode: CoinXBrowserDisplayMode;
}

export interface CoinXBrowserSetDisplayModeInput {
  displayMode: CoinXBrowserDisplayMode;
}

export interface CoinBridge {
  readonly platform: CoinHostPlatform;
  readonly language: {
    getCurrent(): Promise<ApplicationLanguageSnapshot>;
    onChanged(listener: (snapshot: ApplicationLanguageSnapshot) => void): () => void;
  };
  readonly shell: {
    getStatus(): Promise<CoinShellStatus>;
  };
  readonly codex: {
    getStatus(): Promise<CoinCodexStatus>;
    connect(params: { method: CoinCodexLoginMethod }): Promise<CoinCodexActionReceipt>;
    disconnect(): Promise<CoinCodexActionReceipt>;
    onDeviceCode(listener: (notice: CoinCodexDeviceCodeNotice | null) => void): () => void;
  };
  readonly resources: {
    getStatus(): Promise<CoinResourcesStatus>;
    detectGmgn(): Promise<CoinGmgnStatus>;
    saveGmgnApiKey(params: { apiKey: string }): Promise<CoinGmgnSaveReceipt>;
    verifyGmgn(): Promise<CoinGmgnProbeReceipt>;
    cancelGmgnVerify(): Promise<boolean>;
    openGmgnOfficialLink(params: { target: CoinGmgnOfficialLinkTarget }): Promise<boolean>;
    saveService(params: CoinServiceSaveInput): Promise<CoinServiceSaveReceipt>;
  };
  readonly state: {
    load(): Promise<CoinStateLoadResult>;
    save(params: CoinStateSaveInput): Promise<CoinStateSaveResult>;
    recover(): Promise<CoinStateRecoveryResult>;
  };
  readonly data: {
    getSources(): Promise<CoinDataSourceStatus[]>;
    monitor(params: CoinMonitorInput): Promise<CoinDataEnvelope<CoinMonitorResult>>;
    refreshMonitor(params: CoinMonitorInput): Promise<CoinDataEnvelope<CoinMonitorResult>>;
    parseScreener(
      params: CoinScreenerParseInput,
    ): Promise<CoinDataEnvelope<CoinScreenerParseResult>>;
    screen(params: CoinScreenerInput): Promise<CoinDataEnvelope<CoinScreenerResult>>;
    analyzeMeme(
      params: CoinMemeAnalyzeInput,
    ): Promise<CoinDataEnvelope<CoinMemeAnalysisResult>>;
    autoAnalyzeMeme(
      params: CoinMemeAutoAnalyzeInput,
    ): Promise<CoinDataEnvelope<CoinMemeAutoAnalysisResult>>;
    startDiscover(params: CoinDiscoverInput): Promise<CoinDiscoverStartReceipt>;
    stopDiscover(): Promise<CoinDiscoverStopReceipt>;
    cancel(params: CoinCancelInput): Promise<CoinCancelReceipt>;
    onMonitorEvent(listener: (event: CoinMonitorEvent) => void): () => void;
    onDiscoverEvent(listener: (event: CoinDiscoverSnapshot) => void): () => void;
  };
  readonly strategy: {
    evaluate(params: CoinStrategyInput): Promise<CoinDecisionResult>;
  };
  readonly ai: {
    analyze(params: CoinAiAnalyzeInput): Promise<CoinAiAnalyzeResult>;
    cancel(params: CoinAiCancelInput): Promise<CoinAiCancelReceipt>;
  };
  readonly clipboard: {
    readText(): Promise<string>;
  };
  readonly xBrowser: {
    getStatus(): Promise<CoinXBrowserStatus>;
    setDisplayMode(params: CoinXBrowserSetDisplayModeInput): Promise<CoinXBrowserStatus>;
    open(params: CoinXBrowserOpenInput): Promise<CoinXBrowserStatus>;
    focus(): Promise<CoinXBrowserStatus>;
    close(): Promise<CoinXBrowserStatus>;
  };
  readonly window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<CoinWindowSnapshot>;
    close(): Promise<void>;
  };
}
