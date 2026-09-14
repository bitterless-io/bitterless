export type ZellijNativeIpcErrorCode =
  | 'absent'
  | 'timeout'
  | 'aborted'
  | 'disconnected'
  | 'protocol-error'
  | 'rejected'
  | 'unavailable';

export interface ZellijNativeRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Recheck the audited socket identity after connecting, before sending destructive IPC. */
  verifyEndpoint?: () => boolean;
}

export interface ZellijNativeIpcOptions {
  timeoutMs?: number;
  maxFrameBytes?: number;
}

export type ZellijNativeLayout =
  | { filePath: string }
  | { builtinName: string }
  | { url: string }
  | { stringified: string };

export interface ZellijNativeFirstClientOptions {
  configFilePath: string;
  configDir?: string;
  cwd?: string;
  layout?: ZellijNativeLayout;
  terminalWindowSize?: { cols: number; rows: number };
  dataDir?: string;
  isDebug?: boolean;
  forceRunLayoutCommands?: boolean;
  hostTerminalEnv?: Record<string, string>;
}

export interface ZellijNativeClientMessage {
  message?: string;
  connStatus?: Record<string, never>;
  killSession?: Record<string, never>;
  firstClientConnected?: {
    cliAssets: ZellijNativeFirstClientOptions;
    isWebClient?: boolean;
  };
  action?: {
    action: {
      listPanes?: { outputJson: boolean; showAll?: boolean };
      currentTabInfo?: { outputJson: boolean };
    };
    isCliClient: boolean;
    terminalId?: number;
    clientId?: number;
  };
}

export interface ZellijNativeServerMessage {
  message?: string;
  connected?: Record<string, never>;
  unblockInputThread?: Record<string, never>;
  exit?: { exitReason: number; payload?: string };
  log?: { lines?: string[] };
  logError?: { lines?: string[] };
}
