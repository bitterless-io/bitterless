export const COIN_TABS = ['monitor', 'screener', 'meme', 'strategy', 'history'] as const;

export type CoinTab = (typeof COIN_TABS)[number];
export type CoinMemeMode = 'discover' | 'analyze';
export type CoinSecondaryView = 'history' | 'resources';
export type CoinWindowAction = 'minimize' | 'maximize' | 'close';
