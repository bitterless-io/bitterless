import type { CoinBridge } from '@shared/coin/coinBridge.type';

declare global {
  interface Window {
    readonly coin: CoinBridge;
  }
}

export {};
