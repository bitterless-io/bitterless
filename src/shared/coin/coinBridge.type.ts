import type { ApplicationLanguageSnapshot } from '@shared/i18n/applicationLanguage';

export const COIN_IPC_CHANNELS = {
  shellGetStatus: 'coin:shell:get-status',
  languageGetCurrent: 'coin:language:get-current',
  languageChanged: 'coin:language:changed',
  windowMinimize: 'coin:window:minimize',
  windowToggleMaximize: 'coin:window:toggle-maximize',
  windowClose: 'coin:window:close',
} as const;

export type CoinHostPlatform = 'darwin' | 'win32' | 'other';
export type CoinUnavailableState = 'unavailable';

export interface CoinShellStatus {
  schema: 'coin-shell-v1';
  shell: 'ready';
  analysis: CoinUnavailableState;
  codex: CoinUnavailableState;
}

export interface CoinWindowSnapshot {
  maximized: boolean;
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
  readonly window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<CoinWindowSnapshot>;
    close(): Promise<void>;
  };
}
