import { createXpcRendererEmitter } from 'electron-xpc/renderer';

interface CoinWindowApi {
  openCoinWindow(): Promise<void>;
}

export const coinWindowEmitter = createXpcRendererEmitter<CoinWindowApi>('CoinWindowHandler');
